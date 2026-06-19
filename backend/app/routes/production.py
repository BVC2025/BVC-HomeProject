"""
Production & BOM endpoints for BVC24.

Three resources:
  - ProductModel: catalog of vending machine variants
  - BOMItem:      parts list per ProductModel
  - WorkOrder:    a production run for N units of a ProductModel,
                  optionally tied to a customer Project

Cost rollup is intentionally NOT in this iteration — quantities
only. A later pass can compute totals from Inventory.UNIT_PRICE.
"""

from datetime import date, datetime
from pathlib import Path
from typing import Optional
import re
import shutil
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import func, extract, text
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    ProductModel,
    BOMItem,
    WorkOrder,
    Project,
    MaterialCatalog,
    Vendor,
    QCInspection,
    Supplier,
    ProcessStage,
    WorkOrderStageProgress,
    PurchaseOrderLine
)

from app.schemas.production_schema import (
    ProductModelCreate,
    ProductModelUpdate,
    BOMItemCreate,
    BOMItemUpdate,
    WorkOrderCreate,
    WorkOrderStatusUpdate
)

from app.services.bom_catalog import (
    UNIVERSAL_ITEMS,
    MACHINE_SPECIFIC_ITEMS,
    detect_machine_type,
    build_bom_for_product
)


router = APIRouter(prefix="/production", tags=["Production & BOM"])


VALID_WO_STATUSES = {
    "PLANNED",
    "IN_PROGRESS",
    "ON_HOLD",
    "DONE",
    "CANCELLED"
}


# Default manufacturing flow applied to every new ProductModel.
# Mirrors COMMON_STAGES in routes/bvc24_seed.py so manually-created
# products behave the same as the seeded BVC24 catalogue: the
# project-from-product orchestrator iterates these stages to
# generate tasks, and the work-order Gantt renders bars from them.
# The user can edit/add/remove stages per product after creation.
DEFAULT_PRODUCT_STAGES = [
    (1,  "Design Review",            "DESIGN",      4,  "Sign off engineering drawings + customer-specific options."),
    (2,  "Mechanical Design",        "MECHANICAL",  8,  "Cabinet, frame, shelf & tray dimensions finalised."),
    (3,  "Electrical Design",        "ELECTRICAL",  8,  "Control board layout, harness routing, sensor placement."),
    (4,  "Sheet Metal Fabrication",  "FABRICATION", 16, "Cut, bend, weld and paint the cabinet structure."),
    (5,  "Electrical Wiring",        "WIRING",      12, "Run harness, terminate connectors, route low-voltage lines."),
    (6,  "Component Assembly",       "ASSEMBLY",    16, "Mount motors, sensors, display, payment terminal."),
    (7,  "Software Flashing",        "ELECTRICAL",  4,  "Flash firmware, configure menu, test UI flows."),
    (8,  "Bench Testing",            "TESTING",     8,  "Functional smoke test, run dispense cycles, verify telemetry."),
    (9,  "Pre-Dispatch QC",          "QC",          6,  "Quality module checklist run — gates DONE."),
    (10, "Packaging & Dispatch",     "PACKAGING",   4,  "Foam, crate, label, generate dispatch docs.")
]


def seed_default_stages_for_product(
    db: Session,
    product_model_id: int
) -> int:
    """Create the default 40-stage manufacturing flow for a product,
    but only if it doesn't already have stages. Returns the count
    created. Caller is responsible for committing the session.

    Reads the flow from app.services.stage_catalog.build_stages_for_product
    so the canonical list lives in one place and can be reset via
    POST /production/stages/reset-and-seed at any time."""

    from app.services.stage_catalog import build_stages_for_product

    already = db.query(ProcessStage).filter(
        ProcessStage.PRODUCT_MODEL_ID == product_model_id
    ).count()

    if already > 0:

        return 0

    # Fetch the product so we can pass its category through (the
    # catalogue currently ignores it but the hook is in place).
    product = db.query(ProductModel).filter(
        ProductModel.ID == product_model_id
    ).first()

    stages = build_stages_for_product(
        product.CATEGORY if product else None
    )

    for s in stages:

        db.add(ProcessStage(
            PRODUCT_MODEL_ID=product_model_id,
            SEQUENCE=s["sequence"],
            STAGE_NAME=s["stage_name"],
            STAGE_TYPE=s["stage_type"],
            ESTIMATED_HOURS=s["estimated_hours"],
            DESCRIPTION=s["description"],
            IS_ACTIVE=1
        ))

    return len(stages)


# C 608 R1 series vending machine BOM (from 8 Par BOM Excel,
# 17012026 revision). Each new ProductModel gets this seeded so
# the project drawer's BOM table is populated immediately. The
# user can edit, add, or remove lines after creation through the
# Production & BOM page.
#
# Tuple shape: (item_no, material_name, quantity_per_unit, unit,
#               item_type, supplier_category_hint)
# - item_no=None for sub-components that share the parent's number
# - supplier hint left None where there's no obvious category match;
#   user picks the supplier from the Project drawer's dropdown.
DEFAULT_PRODUCT_BOM = [
    # Base assembly
    (1,    "C 608_R1_Base Assembly_17012026",                          1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "C 608_R1_Base Plate_17012026",                             1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "C 608_R1_Wheel Block_17012026",                            4.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "wheelGD-80-F_17012026",                                    4.0,   "pcs", "PURCHASE", None),

    # Cabin outer + stiffners (LHS / RHS / Back / Front)
    (2,    "C 608_R1_Cabin outer LHS Rve-1_17012026",                  1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (3,    "C 608_R1_Left Side Stiffner_1.0mm_17012026",               5.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (4,    "C 608_R1_Inter Side Cover LHS_17012026",                   2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (5,    "C 608_R1 Cabin outer Back Side_1.0mm_17012026",            2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (6,    "C 608_R1_Cabin outer RHS Rve-1_R11_17012026",              1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (7,    "C 608_R1_Right Side Stiffner_1.0mm_17012026",              6.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (8,    "C 608_R1_Inter Side Cover RHS_17012026",                   1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (9,    "C 608_R1_Back Side Stiffner_1.0mm_17012026",               5.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (10,   "C 608_R1_Back Inter Cover_17012026",                       1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (11,   "C 608_R1_Front C Plate_17012026",                          1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (12,   "C 608_R1_Front C Plate 2_17012026",                        2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (13,   "C 608_R1_Front C Plate_Right_17012026",                    1.0,   "pcs", "PURCHASE", "Sheet Metal"),

    # Main door + glass + supports
    (None, "Combo 608 Main Door 2023_17012026",                        1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "20 mm DOG GLASS_17012026",                                 1.0,   "pcs", "PURCHASE", "Glass"),
    (None, "Top GRB Support_17012026",                                 2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "Side GRB Support_17012026",                                1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "RUBBER BEADING SUPPORT Combo 608 Bottom_17012026",         1.0,   "pcs", "PURCHASE", None),
    (None, "MK 01BVC201208001P1_SA_C1_P05 DOOR BUSHV.02_17012026",     2.0,   "pcs", "PURCHASE", None),

    # Drag box assembly
    (None, "1.drag box fr.plat_17012026",                              1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "2.drag box back plat_17012026",                            1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "7.drag box left side cover_23012026",                      1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "6.drag box right side cover_23012026",                     1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "16.drag box rod_17012026",                                 1.0,   "pcs", "PURCHASE", None),
    (None, "4.drag box door_17012026",                                 1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "5.drag box door_23012026",                                 1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "M6 SCREW",                                                 80.0,  "pcs", "PURCHASE", None),
    (None, "M6 WELD NUT",                                              80.0,  "pcs", "PURCHASE", None),
    (None, "8.DRAG BOX DOOR_17012026",                                 1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "3.drag box bottem piece_17012026",                         1.0,   "pcs", "PURCHASE", "Sheet Metal"),

    # Lever + link arms (door mechanism)
    (None, "Lever Patta1_A0_23012026",                                 2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "Lever Patta2_A0_23012026",                                 2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "Link Patta_A0_23012026",                                   2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "M6 X 10L Mushroom head rivet",                             4.0,   "pcs", "PURCHASE", None),
    (None, "17.drag box rod_17012026",                                 1.0,   "pcs", "PURCHASE", None),

    # Rubber beading supports
    (None, "RUBBER BEADING SUPPORT Combo 608 LHS_17012026",            1.0,   "pcs", "PURCHASE", None),
    (None, "RUBBER BEADING SUPPORT Combo 608 RHS_17012026",            1.0,   "pcs", "PURCHASE", None),
    (None, "RUBBER BEADING SUPPORT Combo 608 Top_17012026",            1.0,   "pcs", "PURCHASE", None),
    (None, "C 608 RU Be_17012026 E",                                   1.0,   "pcs", "PURCHASE", None),

    # Pillers + partition + trays + motors (vending mechanism)
    (None, "C 608 Piller LHS",                                         2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "PART ION SIDE PLATE",                                      60.0,  "pcs", "PURCHASE", "Sheet Metal"),
    (None, "Tray Motor Clamp 2023",                                    100.0, "pcs", "PURCHASE", "Sheet Metal"),
    (None, "Tray motor",                                               100.0, "pcs", "PURCHASE", "Motors"),
    (None, "spring samp",                                              100.0, "pcs", "PURCHASE", None),
    (None, "04 - TRAY SLIDE SUPORT-RH",                                12.0,  "pcs", "PURCHASE", "Sheet Metal"),
    (None, "tray wheel 28 OD",                                         12.0,  "pcs", "PURCHASE", None),
    (None, "Tray Wheel Fixing Bolt",                                   12.0,  "pcs", "PURCHASE", None),
    (None, "08 - TRAY STRIFNER",                                       2.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "MirrorCE RAIL_FG",                                         12.0,  "pcs", "PURCHASE", None),

    # Top + lock + cover plates
    (16,   "Top Hinge",                                                1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "C 608_R1_Cabin Inter Top Cover_17012026",                  1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "C 608_R1_Top Side Stiffner_1.0mm_17012026",                3.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "C 608_R1_Top Sheet_17012026",                              1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (18,   "C 608 Lock_17012026",                                      1.0,   "pcs", "PURCHASE", None),
    (19,   "C 608 cover plate LHS",                                    1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (20,   "C 608 cover plate RHS",                                    1.0,   "pcs", "PURCHASE", "Sheet Metal"),

    # Lower supports + refrigeration + CVM RH assembly
    (22,   "PILLER LOWER SUPPORT L CLAMP",                             4.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (23,   "RUBBER BEADING SUPPORT Combo 608 LOW _17012026",           1.0,   "pcs", "PURCHASE", None),
    (25,   "REFRIGIRACTION BOX ASSEMBLY",                              1.0,   "pcs", "PURCHASE", "Refrigeration"),
    (27,   "CVM_RH_1",                                                 1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "CVM_RH_3",                                                 1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (None, "CVM_RH_2",                                                 1.0,   "pcs", "PURCHASE", "Sheet Metal"),
    (28,   "SIDE COVER SHEET",                                         2.0,   "pcs", "PURCHASE", "Sheet Metal"),

    # Fasteners
    (None, "M5 SCREW",                                                 80.0,  "pcs", "PURCHASE", None),
    (None, "M4 SCREW",                                                 80.0,  "pcs", "PURCHASE", None),
]


def _build_supplier_category_lookup(
    db: Session,
    vendor_id: int | None
) -> dict:
    """category-string → Supplier.ID. Tries the explicit vendor
    first, falls back to BVC by name, then any supplier in the DB.
    Same forgiving pattern as _resolve_vendor_id."""

    sup_pool = []

    if vendor_id:

        sup_pool = db.query(Supplier).filter(
            Supplier.VENDOR_ID == vendor_id
        ).all()

    if not sup_pool:

        bvc = db.query(Vendor).filter(
            Vendor.VENDOR_NAME == "Bharath Vending Corporation"
        ).first()

        if bvc:

            sup_pool = db.query(Supplier).filter(
                Supplier.VENDOR_ID == bvc.ID
            ).all()

    if not sup_pool:

        sup_pool = db.query(Supplier).all()

    supplier_by_category: dict = {}

    for s in sup_pool:

        cat = (getattr(s, "CATEGORY", None) or "").strip()

        if cat and cat not in supplier_by_category:

            supplier_by_category[cat] = s.ID

    return supplier_by_category


def seed_default_bom_for_product(
    db: Session,
    product_model_id: int,
    vendor_id: int | None = None
) -> int:
    """Create the category-aware BOM for a product, but only if it
    has no BOM lines yet. Tries to auto-link each line to a matching
    supplier (by CATEGORY) so the supplier picker on the project
    drawer is pre-filled. Returns the count created.

    Uses app.services.bom_catalog.build_bom_for_product() so the
    item list reflects the product's CATEGORY (snack / cold_drink /
    tea_coffee / medicine), falling back to universal items only
    when the category doesn't map to a known machine type."""

    already = db.query(BOMItem).filter(
        BOMItem.PRODUCT_MODEL_ID == product_model_id
    ).count()

    if already > 0:

        return 0

    product = db.query(ProductModel).filter(
        ProductModel.ID == product_model_id
    ).first()

    if not product:

        return 0

    if vendor_id is None:

        vendor_id = product.VENDOR_ID

    supplier_by_category = _build_supplier_category_lookup(db, vendor_id)

    bom_items = build_bom_for_product(product.CATEGORY)

    for idx, item in enumerate(bom_items, start=1):

        db.add(BOMItem(
            PRODUCT_MODEL_ID=product_model_id,
            MATERIAL_NAME=item["material_name"],
            QUANTITY=item["quantity"],
            UNIT=item["unit"],
            ITEM_TYPE=item.get("item_type", "PURCHASE"),
            ITEM_NO=idx,
            NOTES=item.get("category"),
            PREFERRED_SUPPLIER_ID=supplier_by_category.get(item.get("supplier_hint"))
        ))

    return len(bom_items)


def _resolve_vendor_id(db: Session, requested: Optional[int]) -> int:
    """
    Resolve the effective vendor scope. Frontend hard-codes
    vendor_id=1 for the demo, but the BVC24 vendor row may have
    been auto-assigned a different ID (e.g. 2) when seeded
    alongside pre-existing tenant rows. This helper falls back
    to "the BVC24 vendor by name" so the UI works regardless.

    Order:
      1. If `requested` matches a vendor with at least one
         ProductModel row, use it.
      2. Otherwise return the BVC24 vendor's ID (by name).
      3. Last resort: first vendor in the DB.
    """

    if requested:

        has_data = (
            db.query(ProductModel)
            .filter(ProductModel.VENDOR_ID == requested)
            .first()
            is not None
        )

        if has_data:

            return requested

    bvc = db.query(Vendor).filter(
        Vendor.VENDOR_NAME == "Bharath Vending Corporation"
    ).first()

    if bvc:

        return bvc.ID

    any_v = db.query(Vendor).first()

    return any_v.ID if any_v else (requested or 1)


def _generate_wo_number(db: Session, vendor_id: int) -> str:
    """
    Sequential per-year number: WO-YYYY-NNNN.

    WO_NUMBER is globally unique (not per-vendor), so a simple
    count-based approach collides when records are deleted or
    multiple vendors share the same year. We scan the actual
    highest sequence number used for this year across ALL vendors
    and increment.
    """

    year = datetime.utcnow().year

    prefix = f"WO-{year}-"

    existing = db.query(WorkOrder.WO_NUMBER).filter(
        WorkOrder.WO_NUMBER.like(f"{prefix}%")
    ).all()

    max_seq = 0

    for (num,) in existing:

        try:

            seq = int((num or "").split("-")[-1])

            if seq > max_seq:

                max_seq = seq

        except (ValueError, IndexError):

            continue

    return f"{prefix}{max_seq + 1:04d}"


def _serialize_model(m: ProductModel) -> dict:

    return {
        "ID": m.ID,
        "MODEL_NAME": m.MODEL_NAME,
        "MODEL_CODE": m.MODEL_CODE,
        "CATEGORY": m.CATEGORY,
        "DESCRIPTION": m.DESCRIPTION,
        "ESTIMATED_BUILD_DAYS": m.ESTIMATED_BUILD_DAYS,
        "STATUS": m.STATUS,
        "VENDOR_ID": m.VENDOR_ID,
        "CREATED_AT": (
            m.CREATED_AT.isoformat() if m.CREATED_AT else None
        )
    }


def _serialize_bom(
    b: BOMItem,
    supplier: Optional[Supplier] = None,
    stage: Optional[ProcessStage] = None
) -> dict:

    return {
        "ID": b.ID,
        "PRODUCT_MODEL_ID": b.PRODUCT_MODEL_ID,
        "MATERIAL_ID": b.MATERIAL_ID,
        "MATERIAL_NAME": b.MATERIAL_NAME,
        "QUANTITY": b.QUANTITY,
        "UNIT": b.UNIT,
        "ITEM_TYPE": b.ITEM_TYPE or "PURCHASE",
        "PREFERRED_SUPPLIER_ID": b.PREFERRED_SUPPLIER_ID,
        "PREFERRED_SUPPLIER_NAME": (
            supplier.COMPANY_NAME if supplier else None
        ),
        "PREFERRED_SUPPLIER_CODE": (
            supplier.SUPPLIER_CODE if supplier else None
        ),
        "PROCESS_STAGE_ID": b.PROCESS_STAGE_ID,
        "PROCESS_STAGE_NAME": (
            stage.STAGE_NAME if stage else None
        ),
        "ITEM_NO": b.ITEM_NO,
        "IMAGE_URL": b.IMAGE_URL,
        "NOTES": b.NOTES
    }


def _bom_with_links(db: Session, model_id: int) -> list[dict]:
    """Return BOM lines for a model with supplier + stage names joined."""

    rows = (
        db.query(BOMItem, Supplier, ProcessStage)
        .outerjoin(
            Supplier,
            BOMItem.PREFERRED_SUPPLIER_ID == Supplier.ID
        )
        .outerjoin(
            ProcessStage,
            BOMItem.PROCESS_STAGE_ID == ProcessStage.ID
        )
        .filter(BOMItem.PRODUCT_MODEL_ID == model_id)
        .order_by(BOMItem.ID)
        .all()
    )

    return [_serialize_bom(b, sup, stage) for b, sup, stage in rows]


def _serialize_wo(
    wo: WorkOrder,
    model: Optional[ProductModel] = None,
    project: Optional[Project] = None
) -> dict:

    return {
        "ID": wo.ID,
        "WO_NUMBER": wo.WO_NUMBER,
        "PRODUCT_MODEL_ID": wo.PRODUCT_MODEL_ID,
        "PRODUCT_MODEL_NAME": model.MODEL_NAME if model else None,
        "PRODUCT_MODEL_CODE": model.MODEL_CODE if model else None,
        "PROJECT_ID": wo.PROJECT_ID,
        "PROJECT_NAME": project.PROJECT_NAME if project else None,
        "QUANTITY": wo.QUANTITY,
        "STATUS": wo.STATUS,
        "PLANNED_START_DATE": (
            wo.PLANNED_START_DATE.isoformat()
            if wo.PLANNED_START_DATE else None
        ),
        "PLANNED_END_DATE": (
            wo.PLANNED_END_DATE.isoformat()
            if wo.PLANNED_END_DATE else None
        ),
        "ACTUAL_START_DATE": (
            wo.ACTUAL_START_DATE.isoformat()
            if wo.ACTUAL_START_DATE else None
        ),
        "ACTUAL_END_DATE": (
            wo.ACTUAL_END_DATE.isoformat()
            if wo.ACTUAL_END_DATE else None
        ),
        "NOTES": wo.NOTES,
        "CREATED_AT": (
            wo.CREATED_AT.isoformat() if wo.CREATED_AT else None
        )
    }


# ----------------------------------------------------------------
# ProductModel
# ----------------------------------------------------------------

@router.post("/models")
def create_product_model(
    data: ProductModelCreate,
    db: Session = Depends(get_db)
):

    clash = db.query(ProductModel).filter(
        ProductModel.VENDOR_ID == data.VENDOR_ID,
        ProductModel.MODEL_CODE == data.MODEL_CODE
    ).first()

    if clash:

        raise HTTPException(
            status_code=409,
            detail=(
                f"MODEL_CODE {data.MODEL_CODE} already exists "
                f"for this vendor."
            )
        )

    model = ProductModel(
        MODEL_NAME=data.MODEL_NAME,
        MODEL_CODE=data.MODEL_CODE,
        CATEGORY=data.CATEGORY,
        DESCRIPTION=data.DESCRIPTION,
        ESTIMATED_BUILD_DAYS=data.ESTIMATED_BUILD_DAYS,
        STATUS=data.STATUS,
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(model)

    db.flush()

    # Auto-create the default manufacturing flow so the new product
    # is immediately usable: Gantt has bars, project-from-product
    # has stages to assign as tasks, dashboards aren't blank.
    stages_created = seed_default_stages_for_product(db, model.ID)

    # BOM is user-managed — new products start EMPTY. The admin adds
    # each line manually via the Production & BOM page. They can opt
    # in to the static catalog template at any time via
    # POST /production/models/{id}/seed-default-bom.
    bom_created = 0

    db.commit()

    db.refresh(model)

    return {
        "message": "Product model created",
        "model": _serialize_model(model),
        "stages_seeded": stages_created,
        "bom_seeded": bom_created
    }


@router.get("/models")
def list_product_models(
    vendor_id: int = 1,
    status: Optional[str] = None,
    include_discontinued: bool = False,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    q = db.query(ProductModel).filter(
        ProductModel.VENDOR_ID == vendor_id
    )

    if status:

        q = q.filter(ProductModel.STATUS == status)

    elif not include_discontinued:

        # Hide soft-deleted (DISCONTINUED) models by default
        q = q.filter(ProductModel.STATUS != "DISCONTINUED")

    rows = q.order_by(ProductModel.MODEL_NAME).all()

    return [_serialize_model(m) for m in rows]


@router.get("/models/{model_id}")
def get_product_model(
    model_id: int,
    db: Session = Depends(get_db)
):

    model = db.query(ProductModel).filter(
        ProductModel.ID == model_id
    ).first()

    if not model:

        raise HTTPException(status_code=404, detail="Model not found")

    bom = _bom_with_links(db, model_id)

    stages = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == model_id,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    return {
        "model": _serialize_model(model),
        "bom": bom,
        "bom_item_count": len(bom),
        "stages": [
            {
                "ID": s.ID,
                "SEQUENCE": s.SEQUENCE,
                "STAGE_NAME": s.STAGE_NAME,
                "STAGE_TYPE": s.STAGE_TYPE,
                "ESTIMATED_HOURS": s.ESTIMATED_HOURS
            }
            for s in stages
        ]
    }


@router.post("/models/{model_id}/seed-default-bom")
def seed_default_bom_route(
    model_id: int,
    force: bool = False,
    db: Session = Depends(get_db)
):
    """Backfill the C 608 R1 BOM template on a product.

    Default behaviour is idempotent — only seeds when the product
    has zero BOM lines (safe to click repeatedly).

    Pass `?force=true` to wipe the existing BOM first, then reseed
    with the latest DEFAULT_PRODUCT_BOM template. Uploaded images
    survive only if the BOMItem ID stays the same, which it won't
    on a force-reseed — they'll need to be re-uploaded."""

    model = db.query(ProductModel).filter(
        ProductModel.ID == model_id
    ).first()

    if not model:

        raise HTTPException(status_code=404, detail="Model not found")

    wiped = 0

    if force:

        wiped = db.query(BOMItem).filter(
            BOMItem.PRODUCT_MODEL_ID == model.ID
        ).delete(synchronize_session=False)

        db.flush()

    seeded = seed_default_bom_for_product(
        db, model.ID, vendor_id=model.VENDOR_ID
    )

    db.commit()

    if force:

        message = (
            f"Cleared {wiped} old line(s) and seeded "
            f"{seeded} fresh BOM line(s) from the C 608 R1 template."
        )

    elif seeded > 0:

        message = f"Seeded {seeded} BOM line(s)."

    else:

        message = "Product already has BOM lines — nothing seeded."

    return {
        "message": message,
        "bom_seeded": seeded,
        "bom_wiped": wiped,
        "model_id": model.ID
    }


@router.post("/bom/reset-and-seed")
def reset_and_seed_bom(
    payload: dict = Body(default_factory=dict),
    db: Session = Depends(get_db)
):
    """Wipe and re-seed the BOM for every ProductModel under a
    vendor, using the category-aware bom_catalog.

    Body (all optional):
        {
            "VENDOR_ID": 1,        # default 1
            "DRY_RUN":   false      # default false
        }

    DRY_RUN=true returns a preview (per-product item counts + how
    many BOM rows would be wiped) without touching the DB.

    Wipe order — FK-safe:
        1. NULL out PurchaseOrderLine.BOM_ITEM_ID for any row that
           points at a BOMItem we're about to delete (preserves PO
           history; only breaks the link back to the BOM).
        2. DELETE FROM bom_item WHERE PRODUCT_MODEL_ID IN
           (SELECT ID FROM product_model WHERE VENDOR_ID = X).
        3. INSERT one BOMItem row per
           build_bom_for_product(model.CATEGORY) entry.

    Idempotent: running it twice produces the same final state.
    """

    vendor_id = payload.get("VENDOR_ID", 1)

    dry_run = bool(payload.get("DRY_RUN", False))

    vendor_id = _resolve_vendor_id(db, vendor_id)

    try:

        models = (
            db.query(ProductModel)
            .filter(ProductModel.VENDOR_ID == vendor_id)
            .order_by(ProductModel.ID)
            .all()
        )

        # Count what would be wiped: BOMItem rows whose product
        # belongs to this vendor. Reused for both dry-run preview
        # and actual deletion summary.
        wipe_candidate_count = (
            db.query(BOMItem)
            .join(ProductModel, BOMItem.PRODUCT_MODEL_ID == ProductModel.ID)
            .filter(ProductModel.VENDOR_ID == vendor_id)
            .count()
        )

        per_product = []

        total_items = 0

        for model in models:

            machine_type = detect_machine_type(model.CATEGORY)

            preview_items = build_bom_for_product(model.CATEGORY)

            per_product.append({
                "product_model_id": model.ID,
                "model_name": model.MODEL_NAME,
                "model_code": model.MODEL_CODE,
                "category": model.CATEGORY,
                "machine_type": machine_type,
                "items_to_seed": len(preview_items)
            })

            total_items += len(preview_items)

        if dry_run:

            return {
                "message": "Dry run — no changes applied.",
                "dry_run": True,
                "vendor_id": vendor_id,
                "would_wipe": wipe_candidate_count,
                "total_items": total_items,
                "per_product": per_product
            }

        # ------- Step 1: NULL out PurchaseOrderLine.BOM_ITEM_ID -------
        # ORM-level UPDATE so SQLAlchemy generates a DB-portable
        # statement (raw SQL would need dialect-specific subquery
        # syntax for SQLite vs Postgres).
        bom_ids_subq = (
            db.query(BOMItem.ID)
            .join(ProductModel, BOMItem.PRODUCT_MODEL_ID == ProductModel.ID)
            .filter(ProductModel.VENDOR_ID == vendor_id)
            .subquery()
        )

        po_lines_nulled = (
            db.query(PurchaseOrderLine)
            .filter(PurchaseOrderLine.BOM_ITEM_ID.in_(bom_ids_subq))
            .update(
                {PurchaseOrderLine.BOM_ITEM_ID: None},
                synchronize_session=False
            )
        )

        db.flush()

        # ------- Step 2: DELETE old BOMItem rows -------
        wiped_count = (
            db.query(BOMItem)
            .filter(
                BOMItem.PRODUCT_MODEL_ID.in_(
                    db.query(ProductModel.ID).filter(
                        ProductModel.VENDOR_ID == vendor_id
                    )
                )
            )
            .delete(synchronize_session=False)
        )

        db.flush()

        # ------- Step 3: SEED fresh BOM per product -------
        supplier_by_category = _build_supplier_category_lookup(db, vendor_id)

        seeded_count = 0

        seed_detail = []

        for model in models:

            bom_items = build_bom_for_product(model.CATEGORY)

            for idx, item in enumerate(bom_items, start=1):

                db.add(BOMItem(
                    PRODUCT_MODEL_ID=model.ID,
                    MATERIAL_NAME=item["material_name"],
                    QUANTITY=item["quantity"],
                    UNIT=item["unit"],
                    ITEM_TYPE=item.get("item_type", "PURCHASE"),
                    ITEM_NO=idx,
                    NOTES=item.get("category"),
                    PREFERRED_SUPPLIER_ID=supplier_by_category.get(
                        item.get("supplier_hint")
                    )
                ))

                seeded_count += 1

            seed_detail.append({
                "product_model_id": model.ID,
                "model_name": model.MODEL_NAME,
                "model_code": model.MODEL_CODE,
                "category": model.CATEGORY,
                "machine_type": detect_machine_type(model.CATEGORY),
                "items_seeded": len(bom_items)
            })

        db.commit()

        return {
            "message": (
                f"Wiped {wiped_count} BOM line(s) and seeded "
                f"{seeded_count} fresh line(s) across "
                f"{len(models)} product(s)."
            ),
            "dry_run": False,
            "vendor_id": vendor_id,
            "wiped_count": wiped_count,
            "seeded_count": seeded_count,
            "po_lines_unlinked": po_lines_nulled,
            "per_product": seed_detail
        }

    except HTTPException:

        raise

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"BOM reset-and-seed failed: {exc}"
        )


@router.post("/stages/reset-and-seed")
def reset_and_seed_stages(
    payload: dict = Body(default_factory=dict),
    db: Session = Depends(get_db)
):
    """Replace the manufacturing-stages flow for every ProductModel
    under a vendor with the canonical 40-stage catalogue defined in
    app.services.stage_catalog.

    Body (all optional):
        {"VENDOR_ID": 1, "DRY_RUN": false}

    DRY_RUN=true returns a preview of what would change without
    touching the database.

    FK-safe wipe strategy:
      ProcessStage is referenced by WorkOrderStageProgress.STAGE_ID,
      so we can't blindly DELETE old stages — that would break the
      Gantt drawer for any work order already in progress. Strategy:
        1. Mark every stage that currently has WO-progress references
           as IS_ACTIVE=0 (soft-disable — Gantt still resolves the
           FK, but the spawn-for-wo loop ignores them).
        2. Hard-delete stages with NO references (safe to remove).
        3. INSERT the 40 canonical stages with IS_ACTIVE=1 per
           product.

    Existing work orders keep their old stage rows intact. NEW work
    orders pick up the 40-stage flow.

    Idempotent: running twice gives the same final state — duplicate
    sequence numbers per product are avoided by the dedup filter on
    SEQUENCE + STAGE_NAME inside the per-product loop.
    """

    from sqlalchemy import distinct as sql_distinct

    from app.services.stage_catalog import (
        build_stages_for_product,
        DEFAULT_STAGES,
        total_estimated_days
    )

    vendor_id = payload.get("VENDOR_ID", 1)

    dry_run = bool(payload.get("DRY_RUN", False))

    vendor_id = _resolve_vendor_id(db, vendor_id)

    try:

        models = (
            db.query(ProductModel)
            .filter(ProductModel.VENDOR_ID == vendor_id)
            .order_by(ProductModel.ID)
            .all()
        )

        # Count existing stages for the dry-run preview
        existing_stage_count = (
            db.query(ProcessStage)
            .join(
                ProductModel,
                ProcessStage.PRODUCT_MODEL_ID == ProductModel.ID
            )
            .filter(ProductModel.VENDOR_ID == vendor_id)
            .count()
        )

        new_stages_per_product = len(DEFAULT_STAGES)

        per_product = []

        for model in models:

            per_product.append({
                "product_model_id": model.ID,
                "model_name":       model.MODEL_NAME,
                "model_code":       model.MODEL_CODE,
                "category":         model.CATEGORY,
                "stages_to_seed":   new_stages_per_product
            })

        if dry_run:

            return {
                "message":               "Dry run — no changes applied.",
                "dry_run":               True,
                "vendor_id":             vendor_id,
                "existing_stages":       existing_stage_count,
                "would_seed_per_product": new_stages_per_product,
                "total_to_seed":         new_stages_per_product * len(models),
                "estimated_days_per_build": total_estimated_days(),
                "per_product":           per_product
            }

        # ------- Step 1: classify existing stages by FK pressure -------
        # Stages with WO-progress refs → soft-disable.
        # Stages without refs → hard-delete.
        product_ids = [m.ID for m in models]

        if not product_ids:

            return {
                "message": "No products found for this vendor — nothing to do.",
                "dry_run": False,
                "vendor_id": vendor_id,
                "wiped_count": 0,
                "soft_disabled_count": 0,
                "seeded_count": 0,
                "per_product": []
            }

        # IDs of stages currently referenced by any WOStageProgress row
        referenced_ids = {
            row[0] for row in (
                db.query(sql_distinct(WorkOrderStageProgress.STAGE_ID))
                .join(
                    ProcessStage,
                    WorkOrderStageProgress.STAGE_ID == ProcessStage.ID
                )
                .filter(ProcessStage.PRODUCT_MODEL_ID.in_(product_ids))
                .all()
            ) if row[0] is not None
        }

        # Soft-disable referenced stages — their rows survive but the
        # spawn-for-wo loop (which filters IS_ACTIVE=1) will ignore them.
        soft_disabled_count = (
            db.query(ProcessStage)
            .filter(
                ProcessStage.PRODUCT_MODEL_ID.in_(product_ids),
                ProcessStage.ID.in_(referenced_ids)
            )
            .update(
                {ProcessStage.IS_ACTIVE: 0},
                synchronize_session=False
            )
        ) if referenced_ids else 0

        # Hard-delete the rest
        wiped_count = (
            db.query(ProcessStage)
            .filter(
                ProcessStage.PRODUCT_MODEL_ID.in_(product_ids),
                ~ProcessStage.ID.in_(referenced_ids) if referenced_ids
                else True
            )
            .delete(synchronize_session=False)
        )

        db.flush()

        # ------- Step 2: SEED the 40-stage flow per product -------
        seeded_count = 0

        seed_detail = []

        for model in models:

            stages = build_stages_for_product(model.CATEGORY)

            for s in stages:

                db.add(ProcessStage(
                    PRODUCT_MODEL_ID=model.ID,
                    SEQUENCE=s["sequence"],
                    STAGE_NAME=s["stage_name"],
                    STAGE_TYPE=s["stage_type"],
                    ESTIMATED_HOURS=s["estimated_hours"],
                    DESCRIPTION=s["description"],
                    IS_ACTIVE=1
                ))

                seeded_count += 1

            seed_detail.append({
                "product_model_id": model.ID,
                "model_name":       model.MODEL_NAME,
                "model_code":       model.MODEL_CODE,
                "category":         model.CATEGORY,
                "stages_seeded":    len(stages)
            })

        db.commit()

        return {
            "message": (
                f"Wiped {wiped_count} stage(s), soft-disabled "
                f"{soft_disabled_count} in-use stage(s), and seeded "
                f"{seeded_count} fresh stage(s) across {len(models)} product(s)."
            ),
            "dry_run":              False,
            "vendor_id":            vendor_id,
            "wiped_count":          wiped_count,
            "soft_disabled_count":  soft_disabled_count,
            "seeded_count":         seeded_count,
            "estimated_days_per_build": total_estimated_days(),
            "per_product":          seed_detail
        }

    except HTTPException:

        raise

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Stage reset-and-seed failed: {exc}"
        )


@router.patch("/models/{model_id}")
def update_product_model(
    model_id: int,
    data: ProductModelUpdate,
    db: Session = Depends(get_db)
):

    model = db.query(ProductModel).filter(
        ProductModel.ID == model_id
    ).first()

    if not model:

        raise HTTPException(status_code=404, detail="Model not found")

    for field, value in data.dict(exclude_unset=True).items():

        setattr(model, field, value)

    db.commit()

    db.refresh(model)

    return {
        "message": "Model updated",
        "model": _serialize_model(model)
    }


@router.delete("/models/{model_id}")
def delete_product_model(
    model_id: int,
    db: Session = Depends(get_db)
):
    """Soft delete — flip status to DISCONTINUED. WOs that
    reference this model keep working."""

    model = db.query(ProductModel).filter(
        ProductModel.ID == model_id
    ).first()

    if not model:

        raise HTTPException(status_code=404, detail="Model not found")

    model.STATUS = "DISCONTINUED"

    db.commit()

    return {"message": "Model discontinued"}


# ----------------------------------------------------------------
# BOM items
# ----------------------------------------------------------------

@router.post("/models/{model_id}/bom")
def add_bom_item(
    model_id: int,
    data: BOMItemCreate,
    db: Session = Depends(get_db)
):

    model = db.query(ProductModel).filter(
        ProductModel.ID == model_id
    ).first()

    if not model:

        raise HTTPException(status_code=404, detail="Model not found")

    # If MATERIAL_ID provided but no MATERIAL_NAME, fetch from catalog
    material_name = data.MATERIAL_NAME

    if data.MATERIAL_ID and not material_name:

        mat = db.query(MaterialCatalog).filter(
            MaterialCatalog.ID == data.MATERIAL_ID
        ).first()

        if mat:

            material_name = mat.MATERIAL_NAME

    item = BOMItem(
        PRODUCT_MODEL_ID=model_id,
        MATERIAL_ID=data.MATERIAL_ID,
        MATERIAL_NAME=material_name,
        QUANTITY=data.QUANTITY,
        UNIT=data.UNIT,
        NOTES=data.NOTES
    )

    db.add(item)

    db.commit()

    db.refresh(item)

    return {
        "message": "BOM item added",
        "item": _serialize_bom(item)
    }


@router.get("/models/{model_id}/bom")
def list_bom_items(
    model_id: int,
    db: Session = Depends(get_db)
):

    return _bom_with_links(db, model_id)


@router.patch("/bom/{item_id}")
def update_bom_item(
    item_id: int,
    data: BOMItemUpdate,
    db: Session = Depends(get_db)
):

    item = db.query(BOMItem).filter(BOMItem.ID == item_id).first()

    if not item:

        raise HTTPException(status_code=404, detail="BOM item not found")

    for field, value in data.dict(exclude_unset=True).items():

        setattr(item, field, value)

    db.commit()

    db.refresh(item)

    return {
        "message": "BOM item updated",
        "item": _serialize_bom(item)
    }


@router.delete("/bom/{item_id}")
def delete_bom_item(
    item_id: int,
    db: Session = Depends(get_db)
):

    item = db.query(BOMItem).filter(BOMItem.ID == item_id).first()

    if not item:

        raise HTTPException(status_code=404, detail="BOM item not found")

    db.delete(item)

    db.commit()

    return {"message": "BOM item removed"}


# ----------------------------------------------------------------
# BOM image upload — accepts a single file per BOM line, saves it
# under backend/static/bom/, returns the public /static/... URL.
# ----------------------------------------------------------------

_ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}

_STATIC_BOM_DIR = (
    Path(__file__).resolve().parent.parent.parent / "static" / "bom"
)


def _safe_slug(text: str) -> str:
    """Lowercase, alphanum + hyphen only, capped at 40 chars."""

    cleaned = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")

    return cleaned[:40] or "bom"


@router.post("/bom/{item_id}/upload-image")
def upload_bom_image(
    item_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    item = db.query(BOMItem).filter(BOMItem.ID == item_id).first()

    if not item:

        raise HTTPException(status_code=404, detail="BOM item not found")

    ext = Path(file.filename or "").suffix.lower()

    if ext not in _ALLOWED_IMAGE_EXTS:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported image type '{ext}'. Allowed: "
                + ", ".join(sorted(_ALLOWED_IMAGE_EXTS))
            )
        )

    _STATIC_BOM_DIR.mkdir(parents=True, exist_ok=True)

    # Filename = product slug + bom id + short uuid — collision-safe
    # and predictable when debugging.
    slug = _safe_slug(item.MATERIAL_NAME)

    fname = f"bom-{item.ID}-{slug}-{uuid.uuid4().hex[:6]}{ext}"

    dest = _STATIC_BOM_DIR / fname

    with dest.open("wb") as out:

        shutil.copyfileobj(file.file, out)

    # Remove the previous image (if any) so /static doesn't bloat
    if item.IMAGE_URL:

        try:

            old_name = item.IMAGE_URL.rsplit("/", 1)[-1]

            old_path = _STATIC_BOM_DIR / old_name

            if old_path.exists() and old_path.is_file():

                old_path.unlink()

        except Exception:

            pass

    public_url = f"/static/bom/{fname}"

    item.IMAGE_URL = public_url

    db.commit()

    db.refresh(item)

    return {
        "message": "Image uploaded",
        "image_url": public_url,
        "item_id": item.ID
    }


# ----------------------------------------------------------------
# Work Orders
# ----------------------------------------------------------------

@router.post("/work-orders")
def create_work_order(
    data: WorkOrderCreate,
    db: Session = Depends(get_db)
):

    model = db.query(ProductModel).filter(
        ProductModel.ID == data.PRODUCT_MODEL_ID
    ).first()

    if not model:

        raise HTTPException(
            status_code=404,
            detail="Product model not found"
        )

    project = None

    if data.PROJECT_ID:

        project = db.query(Project).filter(
            Project.ID == data.PROJECT_ID
        ).first()

        if not project:

            raise HTTPException(
                status_code=404,
                detail="Project not found"
            )

    wo = WorkOrder(
        WO_NUMBER=_generate_wo_number(db, data.VENDOR_ID),
        PRODUCT_MODEL_ID=data.PRODUCT_MODEL_ID,
        PROJECT_ID=data.PROJECT_ID,
        QUANTITY=data.QUANTITY,
        STATUS="PLANNED",
        PLANNED_START_DATE=data.PLANNED_START_DATE,
        PLANNED_END_DATE=data.PLANNED_END_DATE,
        NOTES=data.NOTES,
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(wo)

    db.flush()

    # Auto-spawn stage progress rows so the production floor
    # gets a ready-to-tick checklist as soon as the WO opens.
    stages = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == wo.PRODUCT_MODEL_ID,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    for stage in stages:

        db.add(WorkOrderStageProgress(
            WORK_ORDER_ID=wo.ID,
            STAGE_ID=stage.ID,
            STATUS="PENDING"
        ))

    db.commit()

    db.refresh(wo)

    return {
        "message": "Work order created",
        "work_order": _serialize_wo(wo, model, project),
        "stages_spawned": len(stages)
    }


@router.get("/work-orders")
def list_work_orders(
    vendor_id: int = 1,
    status: Optional[str] = None,
    project_id: Optional[int] = None,
    model_id: Optional[int] = None,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    q = (
        db.query(WorkOrder, ProductModel, Project)
        .outerjoin(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .outerjoin(
            Project,
            WorkOrder.PROJECT_ID == Project.ID
        )
        .filter(WorkOrder.VENDOR_ID == vendor_id)
    )

    if status:

        q = q.filter(WorkOrder.STATUS == status)

    if project_id:

        q = q.filter(WorkOrder.PROJECT_ID == project_id)

    if model_id:

        q = q.filter(WorkOrder.PRODUCT_MODEL_ID == model_id)

    rows = q.order_by(WorkOrder.CREATED_AT.desc()).all()

    return [
        _serialize_wo(wo, model, project)
        for wo, model, project in rows
    ]


@router.get("/work-orders/{wo_id}")
def get_work_order(
    wo_id: int,
    db: Session = Depends(get_db)
):

    row = (
        db.query(WorkOrder, ProductModel, Project)
        .outerjoin(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .outerjoin(
            Project,
            WorkOrder.PROJECT_ID == Project.ID
        )
        .filter(WorkOrder.ID == wo_id)
        .first()
    )

    if not row:

        raise HTTPException(status_code=404, detail="Work order not found")

    wo, model, project = row

    # Include rolled-up BOM × quantity so the production team
    # sees how much of each material they need for this WO.
    bom = (
        db.query(BOMItem)
        .filter(BOMItem.PRODUCT_MODEL_ID == wo.PRODUCT_MODEL_ID)
        .all()
    )

    bom_rolled = [
        {
            "MATERIAL_NAME": b.MATERIAL_NAME,
            "PER_UNIT_QUANTITY": b.QUANTITY,
            "TOTAL_QUANTITY": round(b.QUANTITY * wo.QUANTITY, 3),
            "UNIT": b.UNIT,
            "NOTES": b.NOTES
        }
        for b in bom
    ]

    return {
        "work_order": _serialize_wo(wo, model, project),
        "bom_rolled_up": bom_rolled
    }


@router.patch("/work-orders/{wo_id}/status")
def update_work_order_status(
    wo_id: int,
    data: WorkOrderStatusUpdate,
    db: Session = Depends(get_db)
):

    if data.STATUS not in VALID_WO_STATUSES:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid status. Must be one of "
                f"{sorted(VALID_WO_STATUSES)}"
            )
        )

    wo = db.query(WorkOrder).filter(WorkOrder.ID == wo_id).first()

    if not wo:

        raise HTTPException(status_code=404, detail="Work order not found")

    prev = wo.STATUS

    # QC gate: moving to DONE requires a finalised PASS inspection.
    # Returns 409 with guidance so the UI can prompt the user to
    # run / finalise the inspection first.
    if data.STATUS == "DONE":

        latest_inspection = (
            db.query(QCInspection)
            .filter(QCInspection.WORK_ORDER_ID == wo.ID)
            .order_by(QCInspection.CREATED_AT.desc())
            .first()
        )

        if not latest_inspection or latest_inspection.STATUS != "PASS":

            raise HTTPException(
                status_code=409,
                detail=(
                    "QC gate: cannot mark DONE without a finalised "
                    "PASS inspection. Create or finalise an inspection "
                    "in the Quality module first."
                )
            )

    wo.STATUS = data.STATUS

    today = date.today()

    # Auto-stamp actual dates on transitions
    if data.STATUS == "IN_PROGRESS" and not wo.ACTUAL_START_DATE:

        wo.ACTUAL_START_DATE = today

    if data.STATUS == "DONE" and not wo.ACTUAL_END_DATE:

        wo.ACTUAL_END_DATE = today

        if not wo.ACTUAL_START_DATE:

            wo.ACTUAL_START_DATE = today

    if data.NOTES:

        wo.NOTES = (wo.NOTES or "") + f"\n[{prev}→{data.STATUS}] {data.NOTES}"

    db.commit()

    db.refresh(wo)

    return {
        "message": f"Work order moved {prev} → {data.STATUS}",
        "work_order": _serialize_wo(wo)
    }


@router.delete("/work-orders/{wo_id}")
def delete_work_order(
    wo_id: int,
    db: Session = Depends(get_db)
):
    """
    Hard-delete a Work Order plus its WorkOrderStageProgress rows.
    Blocks deletion if any QC inspections are recorded against
    the WO (real shop-floor data — should not silently vanish).
    Any NCRs that reference the WO are detached, not deleted.
    """

    from app.models.models import QCInspection, NCR

    wo = db.query(WorkOrder).filter(WorkOrder.ID == wo_id).first()

    if not wo:

        raise HTTPException(status_code=404, detail="Work order not found")

    inspection_count = db.query(QCInspection).filter(
        QCInspection.WORK_ORDER_ID == wo.ID
    ).count()

    if inspection_count > 0:

        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot delete {wo.WO_NUMBER}: it has "
                f"{inspection_count} QC inspection(s) on record. "
                f"Cancel the work order instead (status: CANCELLED)."
            )
        )

    # Detach NCRs (keep the NCR history but unlink from this WO)
    db.query(NCR).filter(NCR.WORK_ORDER_ID == wo.ID).update(
        {"WORK_ORDER_ID": None}
    )

    # Cascade-delete stage progress rows
    progress_deleted = db.query(WorkOrderStageProgress).filter(
        WorkOrderStageProgress.WORK_ORDER_ID == wo.ID
    ).delete(synchronize_session=False)

    wo_number = wo.WO_NUMBER

    db.delete(wo)

    db.commit()

    return {
        "message": f"Work order {wo_number} deleted.",
        "stage_progress_deleted": progress_deleted
    }


# ----------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------

@router.get("/dashboard")
def production_dashboard(
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):
    """
    Live counters + per-status totals + top-active models, for
    the production floor + management view.
    """

    vendor_id = _resolve_vendor_id(db, vendor_id)

    base = db.query(WorkOrder).filter(WorkOrder.VENDOR_ID == vendor_id)

    by_status = {}

    for status in VALID_WO_STATUSES:

        by_status[status] = base.filter(WorkOrder.STATUS == status).count()

    total_wo = base.count()

    total_units_in_progress = (
        base.filter(WorkOrder.STATUS == "IN_PROGRESS")
        .with_entities(func.coalesce(func.sum(WorkOrder.QUANTITY), 0))
        .scalar()
        or 0
    )

    # Top 5 active models — by units currently in progress
    active_by_model = (
        db.query(
            ProductModel.ID,
            ProductModel.MODEL_NAME,
            ProductModel.MODEL_CODE,
            func.coalesce(
                func.sum(WorkOrder.QUANTITY), 0
            ).label("units")
        )
        .join(WorkOrder, WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID)
        .filter(
            WorkOrder.VENDOR_ID == vendor_id,
            WorkOrder.STATUS.in_(["PLANNED", "IN_PROGRESS"])
        )
        .group_by(
            ProductModel.ID,
            ProductModel.MODEL_NAME,
            ProductModel.MODEL_CODE
        )
        .order_by(func.sum(WorkOrder.QUANTITY).desc())
        .limit(5)
        .all()
    )

    return {
        "total_work_orders": total_wo,
        "total_units_in_progress": int(total_units_in_progress),
        "by_status": by_status,
        "top_active_models": [
            {
                "MODEL_ID": r[0],
                "MODEL_NAME": r[1],
                "MODEL_CODE": r[2],
                "units": int(r[3])
            }
            for r in active_by_model
        ]
    }
