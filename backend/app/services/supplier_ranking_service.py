"""
Supplier Ranking & Purchase Recommendation Service.

This service is the ranking engine for the procurement module.
It computes a composite score for every (Vendor, Product, Supplier)
triplet and persists ranked rows + a best-supplier recommendation.

Scoring weights (configurable here — no DB changes needed):
  WEIGHT_PRICE        = 0.40
  WEIGHT_SENIORITY    = 0.20
  WEIGHT_AVAILABILITY = 0.20
  WEIGHT_PERFORMANCE  = 0.20

Trigger matrix (called after any relevant change):
  - supplier_product price updated → recalculate_ranking_for_product()
  - supplier_product AVAILABLE_QTY updated → recalculate_ranking_for_product()
  - supplier STATUS changed → recalculate_ranking_for_supplier()
  - GRN finalized → recalculate_performance_for_supplier() which cascades
  - New supplier approved → recalculate_ranking_for_supplier()
  - POST /procurement/recalculate → recalculate_all_for_vendor()
"""

from datetime import datetime, date
from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.models import Supplier, PurchaseOrder, GoodsReceiptNote, GoodsReceiptLine
from app.models.inventory_models import ProductMaster
from app.models.supplier_models import (
    SupplierInvitation,
    SupplierProduct,
    SupplierRanking,
    PurchaseRecommendation,
    SupplierPerformanceMetrics,
)

# ─────────────────────────────────────────────────────────────────────
# Scoring Weights
# ─────────────────────────────────────────────────────────────────────
WEIGHT_PRICE = 0.40
WEIGHT_SENIORITY = 0.20
WEIGHT_AVAILABILITY = 0.20
WEIGHT_PERFORMANCE = 0.20

# Score used for new suppliers with no performance history yet
DEFAULT_PERFORMANCE_SCORE = 50.0


# ─────────────────────────────────────────────────────────────────────
# Core ranking algorithm
# ─────────────────────────────────────────────────────────────────────

def recalculate_ranking_for_product(db: Session, vendor_id: int, product_id: str) -> None:
    """
    Compute composite scores and ranks for all suppliers of a product,
    then upsert SupplierRanking rows and update PurchaseRecommendation.

    Safe to call repeatedly — always produces the same result for the
    same input data (idempotent).
    """
    # Load all active SupplierProduct rows for this (vendor, product)
    active_sps: List[SupplierProduct] = (
        db.query(SupplierProduct)
        .join(Supplier, Supplier.ID == SupplierProduct.SUPPLIER_ID)
        .filter(
            SupplierProduct.VENDOR_ID == vendor_id,
            SupplierProduct.PRODUCT_ID == product_id,
            SupplierProduct.STATUS == "ACTIVE",
            Supplier.STATUS == "ACTIVE",
        )
        .all()
    )

    if not active_sps:
        # No active suppliers — remove any stale recommendation
        _clear_recommendation(db, vendor_id, product_id)
        return

    supplier_ids = [sp.SUPPLIER_ID for sp in active_sps]

    # ── Price scores ──────────────────────────────────────────────────
    prices = {sp.SUPPLIER_ID: float(sp.UNIT_PRICE) for sp in active_sps}
    min_price = min(prices.values())
    price_scores = {
        sid: (min_price / p * 100.0) if p > 0 else 100.0
        for sid, p in prices.items()
    }

    # ── Seniority scores (earlier APPROVED_AT = better) ──────────────
    approved_at_map: dict = {}
    for sp in active_sps:
        inv = (
            db.query(SupplierInvitation)
            .filter(
                SupplierInvitation.SUPPLIER_ID == sp.SUPPLIER_ID,
                SupplierInvitation.VENDOR_ID == vendor_id,
            )
            .order_by(SupplierInvitation.APPROVED_AT.asc())
            .first()
        )
        approved_at_map[sp.SUPPLIER_ID] = inv.APPROVED_AT if inv and inv.APPROVED_AT else None

    # Sort by APPROVED_AT ascending (earliest first = most senior)
    sorted_by_seniority = sorted(
        supplier_ids,
        key=lambda sid: (
            approved_at_map[sid] is None,   # None goes last
            approved_at_map[sid] or datetime.max,
        )
    )
    total = len(sorted_by_seniority)
    seniority_scores = {
        sid: 100.0 - (pos / total * 100.0)
        for pos, sid in enumerate(sorted_by_seniority)
    }

    # ── Availability scores ───────────────────────────────────────────
    qtys = {sp.SUPPLIER_ID: (sp.AVAILABLE_QTY or 0.0) for sp in active_sps}
    total_qty = sum(qtys.values())
    availability_scores = {
        sid: (min(qty / total_qty, 1.0) * 100.0 if total_qty > 0 else 0.0)
        for sid, qty in qtys.items()
    }

    # ── Performance scores ────────────────────────────────────────────
    metrics_map: dict = {}
    perf_rows = (
        db.query(SupplierPerformanceMetrics)
        .filter(
            SupplierPerformanceMetrics.VENDOR_ID == vendor_id,
            SupplierPerformanceMetrics.SUPPLIER_ID.in_(supplier_ids),
        )
        .all()
    )
    for m in perf_rows:
        metrics_map[m.SUPPLIER_ID] = m.OVERALL_SCORE
    performance_scores = {
        sid: metrics_map.get(sid, DEFAULT_PERFORMANCE_SCORE)
        for sid in supplier_ids
    }

    # ── Composite score and ranking ───────────────────────────────────
    composites = {}
    for sp in active_sps:
        sid = sp.SUPPLIER_ID
        composites[sid] = (
            price_scores[sid] * WEIGHT_PRICE
            + seniority_scores[sid] * WEIGHT_SENIORITY
            + availability_scores[sid] * WEIGHT_AVAILABILITY
            + performance_scores[sid] * WEIGHT_PERFORMANCE
        )

    # Sort descending by composite; tie-break: earlier approved wins
    ranked = sorted(
        active_sps,
        key=lambda sp: (
            -composites[sp.SUPPLIER_ID],
            approved_at_map.get(sp.SUPPLIER_ID) or datetime.max,
        )
    )

    # ── Upsert SupplierRanking rows ───────────────────────────────────
    now = datetime.utcnow()
    for rank_pos, sp in enumerate(ranked, start=1):
        sid = sp.SUPPLIER_ID
        existing_rank = (
            db.query(SupplierRanking)
            .filter(
                SupplierRanking.VENDOR_ID == vendor_id,
                SupplierRanking.PRODUCT_ID == product_id,
                SupplierRanking.SUPPLIER_ID == sid,
            )
            .first()
        )
        if existing_rank:
            existing_rank.RANK = rank_pos
            existing_rank.PRICE_SCORE = price_scores[sid]
            existing_rank.SENIORITY_SCORE = seniority_scores[sid]
            existing_rank.AVAILABILITY_SCORE = availability_scores[sid]
            existing_rank.PERFORMANCE_SCORE = performance_scores[sid]
            existing_rank.COMPOSITE_SCORE = composites[sid]
            existing_rank.UNIT_PRICE_AT_RANK = sp.UNIT_PRICE
            existing_rank.SUPPLIER_PRODUCT_ID = sp.ID
            existing_rank.RECALCULATED_AT = now
        else:
            db.add(SupplierRanking(
                VENDOR_ID=vendor_id,
                PRODUCT_ID=product_id,
                SUPPLIER_ID=sid,
                SUPPLIER_PRODUCT_ID=sp.ID,
                RANK=rank_pos,
                PRICE_SCORE=price_scores[sid],
                SENIORITY_SCORE=seniority_scores[sid],
                AVAILABILITY_SCORE=availability_scores[sid],
                PERFORMANCE_SCORE=performance_scores[sid],
                COMPOSITE_SCORE=composites[sid],
                UNIT_PRICE_AT_RANK=sp.UNIT_PRICE,
                RECALCULATED_AT=now,
            ))

    # Remove stale ranking rows for suppliers no longer active
    active_ids = {sp.SUPPLIER_ID for sp in active_sps}
    db.query(SupplierRanking).filter(
        SupplierRanking.VENDOR_ID == vendor_id,
        SupplierRanking.PRODUCT_ID == product_id,
        SupplierRanking.SUPPLIER_ID.not_in(active_ids),
    ).delete(synchronize_session=False)

    # ── Upsert PurchaseRecommendation ─────────────────────────────────
    best_sp = ranked[0]
    reason_parts = [
        f"Lowest price ₹{float(best_sp.UNIT_PRICE):.2f}." if rank_pos == 1 else "",
        f"Price score: {price_scores[best_sp.SUPPLIER_ID]:.1f}/100.",
        f"Composite score: {composites[best_sp.SUPPLIER_ID]:.1f}/100.",
    ]
    reason = " ".join(p for p in reason_parts if p)

    alternatives = [
        {
            "supplier_id": sp.SUPPLIER_ID,
            "unit_price": float(sp.UNIT_PRICE),
            "rank": pos,
            "composite_score": round(composites[sp.SUPPLIER_ID], 2),
        }
        for pos, sp in enumerate(ranked[1:6], start=2)  # top 5 alternatives
    ]

    rec = (
        db.query(PurchaseRecommendation)
        .filter(
            PurchaseRecommendation.VENDOR_ID == vendor_id,
            PurchaseRecommendation.PRODUCT_ID == product_id,
        )
        .first()
    )
    if rec:
        rec.RECOMMENDED_SUPPLIER_ID = best_sp.SUPPLIER_ID
        rec.SUPPLIER_PRODUCT_ID = best_sp.ID
        rec.RECOMMENDED_PRICE = best_sp.UNIT_PRICE
        rec.RECOMMENDATION_REASON = reason
        rec.ALTERNATIVE_SUPPLIER_IDS = alternatives
        rec.IS_ACTIVE = True
        rec.LAST_RECALCULATED_AT = now
    else:
        db.add(PurchaseRecommendation(
            VENDOR_ID=vendor_id,
            PRODUCT_ID=product_id,
            RECOMMENDED_SUPPLIER_ID=best_sp.SUPPLIER_ID,
            SUPPLIER_PRODUCT_ID=best_sp.ID,
            RECOMMENDED_PRICE=best_sp.UNIT_PRICE,
            RECOMMENDATION_REASON=reason,
            ALTERNATIVE_SUPPLIER_IDS=alternatives,
            IS_ACTIVE=True,
            LAST_RECALCULATED_AT=now,
        ))

    db.commit()


# ─────────────────────────────────────────────────────────────────────
# Recalculate for all products of a supplier
# ─────────────────────────────────────────────────────────────────────

def recalculate_ranking_for_supplier(db: Session, vendor_id: int, supplier_id: int) -> None:
    """Called when a supplier is approved, deactivated, or their data changes."""
    product_ids = [
        row.PRODUCT_ID
        for row in db.query(SupplierProduct.PRODUCT_ID)
        .filter(
            SupplierProduct.VENDOR_ID == vendor_id,
            SupplierProduct.SUPPLIER_ID == supplier_id,
        )
        .distinct()
        .all()
    ]
    for product_id in product_ids:
        recalculate_ranking_for_product(db, vendor_id, product_id)


# ─────────────────────────────────────────────────────────────────────
# Full vendor recalculation
# ─────────────────────────────────────────────────────────────────────

def recalculate_all_for_vendor(db: Session, vendor_id: int) -> int:
    """Recalculate rankings for every product of a vendor. Returns product count."""
    product_ids = [
        row.PRODUCT_ID
        for row in db.query(SupplierProduct.PRODUCT_ID)
        .filter(SupplierProduct.VENDOR_ID == vendor_id)
        .distinct()
        .all()
    ]
    for product_id in product_ids:
        recalculate_ranking_for_product(db, vendor_id, product_id)
    return len(product_ids)


# ─────────────────────────────────────────────────────────────────────
# Supplier performance metrics
# ─────────────────────────────────────────────────────────────────────

def recalculate_performance_for_supplier(db: Session, vendor_id: int, supplier_id: int) -> None:
    """
    Aggregate supplier KPIs from PurchaseOrder + GoodsReceiptNote + GoodsReceiptLine
    and upsert SupplierPerformanceMetrics.
    Called after every GRN finalization.
    """
    # Total POs
    total_orders = db.query(PurchaseOrder).filter(
        PurchaseOrder.SUPPLIER_ID == supplier_id,
    ).count()

    completed_orders = db.query(PurchaseOrder).filter(
        PurchaseOrder.SUPPLIER_ID == supplier_id,
        PurchaseOrder.STATUS.in_(["RECEIVED", "COMPLETED"]),
    ).count()

    # GRN-based metrics
    grns = (
        db.query(GoodsReceiptNote)
        .join(PurchaseOrder, PurchaseOrder.ID == GoodsReceiptNote.PO_ID)
        .filter(
            PurchaseOrder.SUPPLIER_ID == supplier_id,
            GoodsReceiptNote.STATUS == "FINAL",
        )
        .all()
    )

    total_qty_received = 0.0
    total_qty_rejected = 0.0
    on_time = 0
    delayed = 0

    for grn in grns:
        lines = db.query(GoodsReceiptLine).filter(
            GoodsReceiptLine.GRN_ID == grn.ID
        ).all()
        for line in lines:
            total_qty_received += (line.QUANTITY_RECEIVED or 0.0)
            total_qty_rejected += (line.QUANTITY_REJECTED or 0.0)

        # On-time check: GRN received date vs PO expected delivery date
        po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == grn.PO_ID).first()
        if po and po.EXPECTED_DELIVERY_DATE and grn.RECEIVED_DATE:
            if grn.RECEIVED_DATE <= po.EXPECTED_DELIVERY_DATE:
                on_time += 1
            else:
                delayed += 1

    # Compute scores (0-100)
    quality_score = 0.0
    if total_qty_received > 0:
        quality_score = ((total_qty_received - total_qty_rejected) / total_qty_received) * 100.0

    on_time_rate = 0.0
    total_grns = len(grns)
    if total_grns > 0:
        on_time_rate = (on_time / total_grns) * 100.0

    # Price competitiveness: average price_score from existing ranking entries
    ranking_rows = db.query(SupplierRanking).filter(
        SupplierRanking.VENDOR_ID == vendor_id,
        SupplierRanking.SUPPLIER_ID == supplier_id,
    ).all()
    price_comp_score = (
        sum(r.PRICE_SCORE for r in ranking_rows) / len(ranking_rows)
        if ranking_rows else DEFAULT_PERFORMANCE_SCORE
    )

    overall_score = (
        quality_score * 0.40
        + on_time_rate * 0.40
        + price_comp_score * 0.20
    )

    # Upsert metrics row
    metrics = (
        db.query(SupplierPerformanceMetrics)
        .filter(
            SupplierPerformanceMetrics.VENDOR_ID == vendor_id,
            SupplierPerformanceMetrics.SUPPLIER_ID == supplier_id,
        )
        .first()
    )
    if metrics:
        metrics.TOTAL_ORDERS = total_orders
        metrics.COMPLETED_ORDERS = completed_orders
        metrics.ON_TIME_DELIVERIES = on_time
        metrics.DELAYED_DELIVERIES = delayed
        metrics.REJECTED_DELIVERIES = int(total_qty_rejected > 0)
        metrics.TOTAL_QTY_RECEIVED = total_qty_received
        metrics.TOTAL_QTY_REJECTED = total_qty_rejected
        metrics.QUALITY_SCORE = round(quality_score, 2)
        metrics.PRICE_COMPETITIVENESS_SCORE = round(price_comp_score, 2)
        metrics.ON_TIME_RATE = round(on_time_rate, 2)
        metrics.OVERALL_SCORE = round(overall_score, 2)
        metrics.LAST_RECALCULATED_AT = datetime.utcnow()
    else:
        db.add(SupplierPerformanceMetrics(
            VENDOR_ID=vendor_id,
            SUPPLIER_ID=supplier_id,
            TOTAL_ORDERS=total_orders,
            COMPLETED_ORDERS=completed_orders,
            ON_TIME_DELIVERIES=on_time,
            DELAYED_DELIVERIES=delayed,
            TOTAL_QTY_RECEIVED=total_qty_received,
            TOTAL_QTY_REJECTED=total_qty_rejected,
            QUALITY_SCORE=round(quality_score, 2),
            PRICE_COMPETITIVENESS_SCORE=round(price_comp_score, 2),
            ON_TIME_RATE=round(on_time_rate, 2),
            OVERALL_SCORE=round(overall_score, 2),
            LAST_RECALCULATED_AT=datetime.utcnow(),
        ))

    db.commit()

    # Cascade to ranking recalculation
    recalculate_ranking_for_supplier(db, vendor_id, supplier_id)


# ─────────────────────────────────────────────────────────────────────
# Internal helper
# ─────────────────────────────────────────────────────────────────────

def _clear_recommendation(db: Session, vendor_id: int, product_id: str) -> None:
    rec = (
        db.query(PurchaseRecommendation)
        .filter(
            PurchaseRecommendation.VENDOR_ID == vendor_id,
            PurchaseRecommendation.PRODUCT_ID == product_id,
        )
        .first()
    )
    if rec:
        rec.IS_ACTIVE = False
    db.commit()
