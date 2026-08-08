"""
Supplier Ranking & Purchase Recommendation endpoints.

All ranking data is computed by supplier_ranking_service and stored
in supplier_ranking + purchase_recommendation tables.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Supplier
from app.models.inventory_models import ProductMaster
from app.models.supplier_models import (
    SupplierProduct,
    SupplierRanking,
    PurchaseRecommendation,
    SupplierPerformanceMetrics,
)

router = APIRouter(prefix="/procurement", tags=["Procurement"])


@router.get("/recommendations")
def list_recommendations(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    """All active purchase recommendations for a vendor."""
    rows = (
        db.query(PurchaseRecommendation)
        .filter(
            PurchaseRecommendation.VENDOR_ID == vendor_id,
            PurchaseRecommendation.IS_ACTIVE == True,
        )
        .all()
    )
    result = []
    for rec in rows:
        product = db.query(ProductMaster).filter(
            ProductMaster.ID == rec.PRODUCT_ID
        ).first()
        supplier = db.query(Supplier).filter(
            Supplier.ID == rec.RECOMMENDED_SUPPLIER_ID
        ).first()
        result.append({
            "PRODUCT_ID": rec.PRODUCT_ID,
            "PRODUCT_CODE": product.PRODUCT_CODE if product else None,
            "PRODUCT_NAME": product.PRODUCT_NAME if product else None,
            "RECOMMENDED_SUPPLIER_ID": rec.RECOMMENDED_SUPPLIER_ID,
            "RECOMMENDED_SUPPLIER_NAME": supplier.COMPANY_NAME if supplier else None,
            "RECOMMENDED_PRICE": float(rec.RECOMMENDED_PRICE),
            "REASON": rec.RECOMMENDATION_REASON,
            "ALTERNATIVES": rec.ALTERNATIVE_SUPPLIER_IDS,
            "LAST_RECALCULATED_AT": rec.LAST_RECALCULATED_AT.isoformat() if rec.LAST_RECALCULATED_AT else None,
        })
    return result


@router.get("/recommendations/{product_id}")
def get_recommendation(product_id: str, db: Session = Depends(get_db)):
    """Best supplier recommendation for a specific product."""
    rec = db.query(PurchaseRecommendation).filter(
        PurchaseRecommendation.PRODUCT_ID == product_id,
        PurchaseRecommendation.IS_ACTIVE == True,
    ).first()
    if not rec:
        raise HTTPException(
            status_code=404,
            detail="No active recommendation for this product. "
                   "Add at least one active supplier with a price, then recalculate."
        )
    supplier = db.query(Supplier).filter(Supplier.ID == rec.RECOMMENDED_SUPPLIER_ID).first()
    product = db.query(ProductMaster).filter(ProductMaster.ID == product_id).first()
    return {
        "PRODUCT_ID": rec.PRODUCT_ID,
        "PRODUCT_CODE": product.PRODUCT_CODE if product else None,
        "PRODUCT_NAME": product.PRODUCT_NAME if product else None,
        "RECOMMENDED_SUPPLIER_ID": rec.RECOMMENDED_SUPPLIER_ID,
        "RECOMMENDED_SUPPLIER_NAME": supplier.COMPANY_NAME if supplier else None,
        "RECOMMENDED_PRICE": float(rec.RECOMMENDED_PRICE),
        "REASON": rec.RECOMMENDATION_REASON,
        "ALTERNATIVES": rec.ALTERNATIVE_SUPPLIER_IDS,
        "LAST_RECALCULATED_AT": rec.LAST_RECALCULATED_AT.isoformat() if rec.LAST_RECALCULATED_AT else None,
    }


@router.get("/rankings/{product_id}")
def get_product_rankings(product_id: str, db: Session = Depends(get_db)):
    """Full ranking table for a product — all active suppliers ranked by composite score."""
    rows = (
        db.query(SupplierRanking)
        .filter(SupplierRanking.PRODUCT_ID == product_id)
        .order_by(SupplierRanking.RANK.asc())
        .all()
    )
    result = []
    for r in rows:
        supplier = db.query(Supplier).filter(Supplier.ID == r.SUPPLIER_ID).first()
        sp = db.query(SupplierProduct).filter(
            SupplierProduct.ID == r.SUPPLIER_PRODUCT_ID
        ).first()
        result.append({
            "RANK": r.RANK,
            "SUPPLIER_ID": r.SUPPLIER_ID,
            "SUPPLIER_NAME": supplier.COMPANY_NAME if supplier else None,
            "SUPPLIER_CODE": supplier.SUPPLIER_CODE if supplier else None,
            "UNIT_PRICE": float(r.UNIT_PRICE_AT_RANK),
            "CURRENCY": sp.CURRENCY if sp else "INR",
            "MOQ": sp.MOQ if sp else None,
            "LEAD_TIME_DAYS": sp.LEAD_TIME_DAYS if sp else None,
            "PRICE_SCORE": round(r.PRICE_SCORE, 2),
            "AVAILABILITY_SCORE": round(r.AVAILABILITY_SCORE, 2),
            "PERFORMANCE_SCORE": round(r.PERFORMANCE_SCORE, 2),
            "SENIORITY_SCORE": round(r.SENIORITY_SCORE, 2),
            "COMPOSITE_SCORE": round(r.COMPOSITE_SCORE, 2),
            "RECALCULATED_AT": r.RECALCULATED_AT.isoformat() if r.RECALCULATED_AT else None,
        })
    return result


@router.get("/supplier-scorecard/{supplier_id}")
def get_supplier_scorecard(
    supplier_id: int,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """Full scorecard for one supplier — performance metrics + per-product rankings."""
    supplier = db.query(Supplier).filter(Supplier.ID == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    metrics = db.query(SupplierPerformanceMetrics).filter(
        SupplierPerformanceMetrics.VENDOR_ID == vendor_id,
        SupplierPerformanceMetrics.SUPPLIER_ID == supplier_id,
    ).first()

    rankings = (
        db.query(SupplierRanking)
        .filter(
            SupplierRanking.VENDOR_ID == vendor_id,
            SupplierRanking.SUPPLIER_ID == supplier_id,
        )
        .order_by(SupplierRanking.RANK.asc())
        .all()
    )

    ranked_products = []
    for r in rankings:
        product = db.query(ProductMaster).filter(ProductMaster.ID == r.PRODUCT_ID).first()
        ranked_products.append({
            "PRODUCT_ID": r.PRODUCT_ID,
            "PRODUCT_NAME": product.PRODUCT_NAME if product else None,
            "PRODUCT_CODE": product.PRODUCT_CODE if product else None,
            "RANK": r.RANK,
            "UNIT_PRICE": float(r.UNIT_PRICE_AT_RANK),
            "COMPOSITE_SCORE": round(r.COMPOSITE_SCORE, 2),
        })

    return {
        "SUPPLIER_ID": supplier.ID,
        "SUPPLIER_CODE": supplier.SUPPLIER_CODE,
        "COMPANY_NAME": supplier.COMPANY_NAME,
        "STATUS": supplier.STATUS,
        "performance_metrics": {
            "TOTAL_ORDERS": metrics.TOTAL_ORDERS if metrics else 0,
            "COMPLETED_ORDERS": metrics.COMPLETED_ORDERS if metrics else 0,
            "ON_TIME_DELIVERIES": metrics.ON_TIME_DELIVERIES if metrics else 0,
            "DELAYED_DELIVERIES": metrics.DELAYED_DELIVERIES if metrics else 0,
            "QUALITY_SCORE": metrics.QUALITY_SCORE if metrics else 0.0,
            "ON_TIME_RATE": metrics.ON_TIME_RATE if metrics else 0.0,
            "PRICE_COMPETITIVENESS_SCORE": metrics.PRICE_COMPETITIVENESS_SCORE if metrics else 0.0,
            "OVERALL_SCORE": metrics.OVERALL_SCORE if metrics else 0.0,
            "LAST_RECALCULATED_AT": metrics.LAST_RECALCULATED_AT.isoformat() if metrics and metrics.LAST_RECALCULATED_AT else None,
        } if metrics else None,
        "ranked_products": ranked_products,
        "total_products_supplied": len(ranked_products),
    }


@router.post("/recalculate")
def recalculate_all(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    """Admin: trigger full ranking recalculation for all products of a vendor."""
    from app.services.supplier_ranking_service import recalculate_all_for_vendor
    count = recalculate_all_for_vendor(db, vendor_id)
    return {"message": f"Rankings recalculated for {count} product(s)", "products_processed": count}


@router.post("/recalculate/{product_id}")
def recalculate_product(product_id: str, vendor_id: int = Query(1), db: Session = Depends(get_db)):
    """Admin: recalculate ranking for a single product."""
    from app.services.supplier_ranking_service import recalculate_ranking_for_product
    product = db.query(ProductMaster).filter(ProductMaster.ID == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    recalculate_ranking_for_product(db, vendor_id, product_id)
    return {"message": f"Ranking recalculated for product '{product.PRODUCT_NAME}'"}
