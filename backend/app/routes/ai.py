"""
AI-powered admin tools.

Right now this router exposes a single discrete endpoint that the
admin can invoke manually from the UI:

  POST /ai/recommend-products
    Body: {
      CUSTOMER_ID?: int,
      REQUIREMENTS_TEXT?: str,
      TOP_K?: int (default 3, max 10),
      VENDOR_ID?: int (default 1)
    }
    At least one of CUSTOMER_ID / REQUIREMENTS_TEXT is required.

The endpoint is intentionally NOT called from any automatic flow —
it's a tool the admin invokes to brainstorm the right ProductModels
for a customer. Each recommendation is enriched server-side with a
ProductModel snapshot so the UI never needs a second round-trip to
render the result.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import ProductModel
from app.services.product_recommendation_service import (
    recommend_products,
)


router = APIRouter(prefix="/ai", tags=["AI Tools"])


# ----------------------------------------------------------------
# Request / Response models
# ----------------------------------------------------------------

class RecommendProductsRequest(BaseModel):
    """Body for POST /ai/recommend-products.

    At least one of CUSTOMER_ID / REQUIREMENTS_TEXT must be set —
    the endpoint validates this and returns 400 otherwise."""

    CUSTOMER_ID: Optional[int] = Field(
        default=None,
        description="Existing Customer.ID to pull profile + "
                    "requirement rows from."
    )

    REQUIREMENTS_TEXT: Optional[str] = Field(
        default=None,
        description="Free-text description of what the customer wants "
                    "— used in addition to (or instead of) the "
                    "stored CustomerRequirement rows."
    )

    TOP_K: Optional[int] = Field(
        default=3,
        ge=1,
        le=10,
        description="How many ranked picks to return (1–10)."
    )

    VENDOR_ID: Optional[int] = Field(
        default=1,
        description="Scope the candidate pool to this vendor's "
                    "active ProductModels."
    )


# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

def _enrich_with_product_snapshot(
    db: Session,
    recommendations: list,
) -> list:
    """Attach the full ProductModel snapshot to each recommendation
    so the UI can render the result with a single round-trip."""

    if not recommendations:

        return []

    ids = [
        r.get("product_model_id")
        for r in recommendations
        if r.get("product_model_id")
    ]

    if not ids:

        return recommendations

    rows = db.query(ProductModel).filter(
        ProductModel.ID.in_(ids)
    ).all()

    by_id = {row.ID: row for row in rows}

    enriched = []

    for r in recommendations:

        pid = r.get("product_model_id")

        p = by_id.get(pid)

        snapshot = {}

        if p:

            snapshot = {
                "model_name": p.MODEL_NAME or "",
                "model_code": p.MODEL_CODE or "",
                "category": p.CATEGORY or "",
                "estimated_build_days": p.ESTIMATED_BUILD_DAYS or 0,
                "description": p.DESCRIPTION or "",
                "status": p.STATUS or "",
            }

        enriched.append({**r, "product": snapshot})

    return enriched


# ----------------------------------------------------------------
# Endpoint
# ----------------------------------------------------------------

@router.post("/recommend-products")
def recommend_products_endpoint(
    payload: RecommendProductsRequest,
    db: Session = Depends(get_db),
):
    """Rank the vendor's active ProductModels for a customer +/-
    free-text requirements via Gemini, then enrich each pick with
    its catalogue snapshot. See the service module for the scoring
    contract."""

    if not payload.CUSTOMER_ID and not (
        payload.REQUIREMENTS_TEXT and payload.REQUIREMENTS_TEXT.strip()
    ):

        raise HTTPException(
            status_code=400,
            detail=(
                "At least one of CUSTOMER_ID or REQUIREMENTS_TEXT "
                "must be provided."
            )
        )

    # If a CUSTOMER_ID is given, make sure it exists so a typo
    # surfaces as a clean 404 instead of silently producing a
    # generic recommendation with no profile context.
    if payload.CUSTOMER_ID:

        from app.models.models import Customer

        exists = db.query(Customer.ID).filter(
            Customer.ID == payload.CUSTOMER_ID
        ).first()

        if not exists:

            raise HTTPException(
                status_code=404,
                detail=f"Customer {payload.CUSTOMER_ID} not found."
            )

    result = recommend_products(
        db=db,
        customer_id=payload.CUSTOMER_ID,
        requirements_text=payload.REQUIREMENTS_TEXT,
        vendor_id=payload.VENDOR_ID or 1,
        top_k=payload.TOP_K or 3,
    )

    result["recommendations"] = _enrich_with_product_snapshot(
        db, result.get("recommendations") or []
    )

    return result
