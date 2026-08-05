"""
Quotation pricing helpers.

Centralizes the BOM-walk + margin maths used to suggest a unit price
for a ProductModel during auto-generation of quotations.

Why a separate module:
  - The pricing rule (materials + labour + margin) is reused from
    both the quotation routes and any future scheduled reports /
    chatbot answers.
  - Keeping it out of routes/quotation.py lets us evolve the formula
    (e.g. add overhead, supplier-specific price tiers) without
    touching HTTP code.

Pricing rule (current version):

    materials_cost = SUM over BOM rows where ITEM_TYPE = 'PURCHASE'
                       of  quantity * inventory_unit_price
                     (missing prices contribute 0 — never throws)

    labour_cost    = COUNT of BOM rows where ITEM_TYPE = 'PROCESS'
                       * DEFAULT_LABOUR_PER_PROCESS_STAGE  (Rs 500)

    base_cost      = materials_cost + labour_cost

    suggested_price = base_cost * (1 + margin_pct / 100)

Falls back to 0.0 (no exception) when:
  - product has no BOM rows
  - all materials lack inventory prices and no PROCESS rows exist

This lets the auto-gen flow surface a warning and let the sales rep
edit the line manually instead of failing the whole request.
"""

from sqlalchemy.orm import Session

from app.models.models import BOMItem, Inventory


# Flat labour cost added per PROCESS row in the BOM. A crude but
# transparent stand-in until we wire ProcessStage.HOURLY_RATE *
# expected hours. Tune via env later if needed.
DEFAULT_LABOUR_PER_PROCESS_STAGE = 500.0


def _materials_cost_for_bom(
    db: Session,
    product_model_id: int,
    vendor_id: int = 1
) -> float:
    """Sum of (BOM qty * inventory unit price) for PURCHASE rows.

    Uses the HIGHEST inventory unit price on file for each material
    — safer for quoting (we'd rather over-estimate cost than quote
    below cost on a stale low price)."""

    rows = db.query(BOMItem).filter(
        BOMItem.PRODUCT_MODEL_ID == product_model_id,
        BOMItem.ITEM_TYPE == "PURCHASE"
    ).all()

    if not rows:

        return 0.0

    material_ids = [r.PRODUCT_ID for r in rows if r.PRODUCT_ID]

    price_by_mat = {}

    if material_ids:

        invs = db.query(Inventory).filter(
            Inventory.PRODUCT_ID.in_(material_ids),
            Inventory.VENDOR_ID == vendor_id
        ).all()

        for inv in invs:

            current = price_by_mat.get(inv.PRODUCT_ID, 0.0)

            if (inv.UNIT_PRICE or 0) > current:

                price_by_mat[inv.PRODUCT_ID] = inv.UNIT_PRICE or 0.0

    total = 0.0

    for r in rows:

        qty = float(r.QUANTITY or 0)

        price = price_by_mat.get(r.PRODUCT_ID, 0.0) if r.PRODUCT_ID else 0.0

        total += qty * price

    return round(total, 2)


def _labour_cost_for_bom(db: Session, product_model_id: int) -> float:
    """Flat labour estimate: 500 per PROCESS row.

    Rationale: every in-house process stage takes some operator
    time. A flat per-stage figure is a transparent placeholder until
    proper time-study data is in. Override by editing the constant
    at module top."""

    n_process = db.query(BOMItem).filter(
        BOMItem.PRODUCT_MODEL_ID == product_model_id,
        BOMItem.ITEM_TYPE == "PROCESS"
    ).count()

    return round(n_process * DEFAULT_LABOUR_PER_PROCESS_STAGE, 2)


def compute_unit_price_from_bom(
    db: Session,
    product_model_id: int,
    margin_pct: float = 25.0,
    vendor_id: int = 1
) -> float:
    """Suggested unit price for ONE unit of a product.

    base = materials (PURCHASE rows priced from Inventory)
         + labour    (flat per PROCESS row)
    price = base * (1 + margin/100)

    Returns 0.0 (not None) when no BOM rows exist — callers should
    treat 0 as 'admin must edit' and surface a warning."""

    if not product_model_id:

        return 0.0

    materials = _materials_cost_for_bom(db, product_model_id, vendor_id)

    labour = _labour_cost_for_bom(db, product_model_id)

    base = materials + labour

    if base == 0.0:

        return 0.0

    suggested = base * (1.0 + (margin_pct or 0.0) / 100.0)

    return round(suggested, 2)


def get_product_pricing_breakdown(
    db: Session,
    product_model_id: int,
    margin_pct: float = 25.0,
    vendor_id: int = 1
) -> dict:
    """Same maths as compute_unit_price_from_bom but returns the
    component pieces — handy for diagnostics, the auto-price UI
    tooltip, and the chatbot answering 'why is X priced at Y?'."""

    materials = _materials_cost_for_bom(db, product_model_id, vendor_id)

    labour = _labour_cost_for_bom(db, product_model_id)

    base = materials + labour

    margin_amount = round(base * (margin_pct or 0.0) / 100.0, 2)

    suggested_price = round(base + margin_amount, 2)

    return {
        "product_model_id": product_model_id,
        "materials_cost": round(materials, 2),
        "labour_cost": round(labour, 2),
        "base_cost": round(base, 2),
        "margin_percent": margin_pct,
        "margin_amount": margin_amount,
        "suggested_price": suggested_price,
        "labour_per_process_stage": DEFAULT_LABOUR_PER_PROCESS_STAGE
    }
