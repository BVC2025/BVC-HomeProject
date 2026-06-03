"""
AI Product Recommendation service.

Given a customer (and / or a free-text requirements string), this
module asks Google Gemini to rank the vendor's active ProductModel
catalogue and pick the top-K best fits — each with a one-line
rationale, a 0-100 match score, suggested quantity, optional
features and an AMC plan suggestion.

Design goals
------------
- Single Gemini call (response_mime_type=application/json) — no
  multi-turn chatter.
- Walks the GEMINI_MODEL_FALLBACKS chain on 429 / quota errors so a
  throttled model doesn't kill the recommendation.
- Always returns a deterministic structured fallback when Gemini is
  unreachable (key missing, no network, all models exhausted, model
  produced unparseable text). The endpoint never 500s — worst case
  the admin sees a heuristic ranking.
- Strict JSON only; we never trust Gemini's prose and we never use
  markdown fences.
- This module is purely advisory. It does NOT mutate the database
  and it is NOT called from any automatic flow — the admin invokes
  the endpoint as a discrete tool.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Customer,
    CustomerRequirement,
    ProductModel,
)


# ----------------------------------------------------------------
# Reuse the platform-wide Gemini fallback chain. Falls back to a
# sensible default if the gemini_service module is unavailable for
# any reason (e.g. import-time failure during a partial install).
# ----------------------------------------------------------------
try:
    from app.services.gemini_service import (
        GEMINI_API_KEY,
        GEMINI_MODEL_FALLBACKS,
        is_gemini_configured,
    )
except Exception:  # pragma: no cover — defensive import
    GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
    GEMINI_MODEL_FALLBACKS = [
        "gemini-2.0-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest",
        "gemini-2.5-flash",
    ]

    def is_gemini_configured() -> bool:
        return bool(GEMINI_API_KEY)


# ----------------------------------------------------------------
# Output schema reference
# ----------------------------------------------------------------
#
# recommend_products(...) ALWAYS returns a dict shaped like:
# {
#   "recommendations": [
#       {
#           "product_model_id": int,
#           "score": float (0-100),
#           "rationale": str,
#           "suggested_quantity": int,
#           "optional_features": [str, ...],
#           "suggested_amc_plan": str
#       },
#       ...
#   ],
#   "summary": str,
#   "gemini_model_used": str | None,   # None when fallback engaged
#   "source": "gemini" | "fallback"
# }
#
# The route layer enriches each recommendation with the full
# ProductModel snapshot (model_name, model_code, category,
# estimated_build_days, description).


def _is_quota_error(exc: Exception) -> bool:
    """Heuristic for 429 / ResourceExhausted style errors — when
    seen we walk forward in the GEMINI_MODEL_FALLBACKS chain."""

    msg = str(exc).lower()

    return (
        "429" in msg
        or "quota" in msg
        or "rate" in msg
        or "exhaust" in msg
    )


def _safe_parse_json(text: str) -> Optional[Dict[str, Any]]:
    """Robust JSON parse — strips ```json fences and pulls the first
    {...} block if Gemini decorated its reply with prose."""

    if not text:

        return None

    raw = text.strip()

    if raw.startswith("```"):

        raw = re.sub(r"^```(?:json)?", "", raw).strip()

        if raw.endswith("```"):

            raw = raw[:-3].strip()

    try:

        return json.loads(raw)

    except Exception:

        pass

    m = re.search(r"\{[\s\S]*\}", raw)

    if not m:

        return None

    try:

        return json.loads(m.group(0))

    except Exception:

        return None


def _serialize_product(p: ProductModel) -> Dict[str, Any]:
    """Compact dict shown to Gemini — only the fields that help it
    rank, no internal columns."""

    return {
        "product_model_id": p.ID,
        "model_name": p.MODEL_NAME or "",
        "model_code": p.MODEL_CODE or "",
        "category": p.CATEGORY or "",
        "description": (p.DESCRIPTION or "")[:300],
        "estimated_build_days": p.ESTIMATED_BUILD_DAYS or 7,
    }


def _serialize_customer(c: Optional[Customer]) -> Dict[str, Any]:
    """Snapshot of customer attributes that influence product fit."""

    if not c:

        return {}

    return {
        "customer_id": c.ID,
        "customer_name": c.CUSTOMER_NAME or "",
        "business_type": c.BUSINESS_TYPE or "",
        "industry": c.INDUSTRY or "",
        "number_of_branches": c.NUMBER_OF_BRANCHES or 0,
        "expected_monthly_orders": c.EXPECTED_MONTHLY_ORDERS or 0,
        "city": c.CITY or "",
        "state": c.STATE or "",
        "requirement_notes": (c.REQUIREMENT_NOTES or "")[:1000],
    }


def _serialize_requirements(
    rows: List[CustomerRequirement]
) -> List[Dict[str, Any]]:
    """Compact list of the customer's CustomerRequirement rows."""

    out: List[Dict[str, Any]] = []

    for r in rows or []:

        out.append({
            "machine_category": r.MACHINE_CATEGORY or "",
            "machine_name": r.MACHINE_NAME or "",
            "quantity": r.QUANTITY or 1,
            "capacity": r.CAPACITY or "",
            "target_unit_price": r.TARGET_UNIT_PRICE or 0,
            "installation_site": r.INSTALLATION_SITE or "",
            "priority": r.PRIORITY or "MEDIUM",
            "status": r.STATUS or "DRAFT",
            "special_notes": (r.SPECIAL_NOTES or "")[:500],
        })

    return out


def _build_prompt(
    customer_ctx: Dict[str, Any],
    requirements: List[Dict[str, Any]],
    requirements_text: str,
    products: List[Dict[str, Any]],
    top_k: int,
) -> str:
    """The system prompt for Gemini. Locks the model to strict JSON
    using response_mime_type plus an explicit schema in the prompt."""

    return f"""
You are the BVC24 Product Recommendation Engine for Bharath Vending
Corporation (Coimbatore, India). BVC24 manufactures custom and
standard vending machines for hospitals, hotels, schools, malls,
offices, factories, airports and more.

Your job: given a customer's profile and stated requirements, pick
the TOP {top_k} best-fit ProductModels from the catalogue below.
Rank them by overall fit — category match, branch / quantity scale,
target price, urgency, business sector and any explicit notes.

CUSTOMER PROFILE:
```json
{json.dumps(customer_ctx, indent=2)}
```

CUSTOMER REQUIREMENT ROWS (multi-item wishlist, may be empty):
```json
{json.dumps(requirements, indent=2)}
```

FREE-TEXT REQUIREMENTS FROM ADMIN:
{json.dumps(requirements_text or "")}

PRODUCT CATALOGUE (only choose from this list — never invent
product_model_id values not present here):
```json
{json.dumps(products, indent=2)}
```

RANKING RULES:
1. score is 0-100. Best fit = 100, weak fit = 30, irrelevant = 0.
2. Prefer products whose CATEGORY aligns with the customer's
   BUSINESS_TYPE or MACHINE_CATEGORY (e.g. hospital -> medicine,
   office -> snack-beverage / coffee, hotel -> combo / hot-food).
3. If the customer has high EXPECTED_MONTHLY_ORDERS or many
   branches, prefer products with shorter estimated_build_days.
4. suggested_quantity should respect the customer's stated quantity
   if any, else default to 1.
5. optional_features is a short list of upsells worth mentioning
   (e.g. "card payment kiosk", "cooling chamber", "branded wrap").
6. suggested_amc_plan is one of: "BASIC_1Y", "STANDARD_2Y",
   "PREMIUM_3Y" — pick based on scale and priority.

OUTPUT FORMAT — STRICT JSON ONLY, no markdown, no prose around it:
{{
  "recommendations": [
    {{
      "product_model_id": <int from catalogue>,
      "score": <number 0-100>,
      "rationale": "<one or two sentences, customer-friendly>",
      "suggested_quantity": <int>,
      "optional_features": ["...", "..."],
      "suggested_amc_plan": "BASIC_1Y" | "STANDARD_2Y" | "PREMIUM_3Y"
    }}
  ],
  "summary": "<one short paragraph explaining the overall pick>"
}}

Return AT MOST {top_k} items in `recommendations`, sorted by score
DESC. Never include a product_model_id that is not in the catalogue.
""".strip()


def _call_gemini(
    prompt: str,
) -> Dict[str, Any]:
    """Walk the model fallback chain. Returns
    { "parsed": dict|None, "model_used": str|None }.
    Never raises — callers handle parsed=None as a fallback trigger."""

    out: Dict[str, Any] = {"parsed": None, "model_used": None}

    if not is_gemini_configured():

        return out

    try:

        import google.generativeai as genai

    except Exception:

        return out

    try:

        genai.configure(api_key=GEMINI_API_KEY)

    except Exception:

        return out

    last_exc: Optional[Exception] = None

    for model_name in GEMINI_MODEL_FALLBACKS:

        try:

            model = genai.GenerativeModel(
                model_name=model_name,
                generation_config={
                    "response_mime_type": "application/json"
                }
            )

            response = model.generate_content(prompt)

            try:

                text = response.text or ""

            except Exception:

                text = ""

                for cand in getattr(response, "candidates", []) or []:

                    for part in getattr(
                        getattr(cand, "content", None), "parts", []
                    ) or []:

                        text += getattr(part, "text", "") or ""

            parsed = _safe_parse_json(text)

            if parsed:

                out["parsed"] = parsed

                out["model_used"] = model_name

                return out

            # Parsed empty — try next model (maybe a richer one obeys)
            continue

        except Exception as exc:

            last_exc = exc

            if _is_quota_error(exc):

                continue

            # Non-quota error — break early; fallback ranking will run
            break

    # last_exc kept only for debugging — we intentionally swallow it
    # so the route returns the deterministic fallback instead.
    return out


# ----------------------------------------------------------------
# Deterministic fallback ranking
# ----------------------------------------------------------------

# Loose category alignment by business sector. We use this when
# Gemini is unreachable so the admin still gets a reasonable pick.
_BUSINESS_TO_CATEGORIES = {
    "hospital":       ["medicine", "snack-beverage", "combo"],
    "healthcare":     ["medicine", "snack-beverage"],
    "hotel":          ["combo", "hot-food", "snack-beverage"],
    "school":         ["snack-beverage", "combo", "fruits-veg"],
    "college":        ["snack-beverage", "combo", "fruits-veg"],
    "education":      ["snack-beverage", "combo"],
    "office":         ["snack-beverage", "combo", "coffee"],
    "corporate":      ["snack-beverage", "combo", "coffee"],
    "factory":        ["snack-beverage", "combo", "hot-food"],
    "mall":           ["combo", "snack-beverage", "cosmetics"],
    "retail":         ["combo", "snack-beverage", "cosmetics"],
    "airport":        ["combo", "snack-beverage", "kiosk"],
    "transit":        ["combo", "snack-beverage", "kiosk"],
}


def _category_keywords(customer: Optional[Customer]) -> List[str]:
    """Pull category-ish hints from the customer's BUSINESS_TYPE /
    INDUSTRY — used by the heuristic fallback."""

    if not customer:

        return []

    out: List[str] = []

    for attr in ("BUSINESS_TYPE", "INDUSTRY"):

        val = (getattr(customer, attr, None) or "").strip().lower()

        if not val:

            continue

        for key, cats in _BUSINESS_TO_CATEGORIES.items():

            if key in val:

                out.extend(cats)

    return out


def _fallback_rank(
    customer: Optional[Customer],
    requirements: List[CustomerRequirement],
    products: List[ProductModel],
    top_k: int,
) -> List[Dict[str, Any]]:
    """Deterministic heuristic ranker used when Gemini is offline.

    Scoring (max 100):
      - +60  category match against customer BUSINESS_TYPE / INDUSTRY
      - +25  category match against any CustomerRequirement row
      - +15  shorter build time (faster = better, capped)
    """

    biz_cats = set(_category_keywords(customer))

    req_cats = {
        (r.MACHINE_CATEGORY or "").strip().lower()
        for r in (requirements or [])
        if r.MACHINE_CATEGORY
    }

    # Quantity hint — prefer the largest stated requirement
    req_qty = 1

    for r in requirements or []:

        if r.QUANTITY and r.QUANTITY > req_qty:

            req_qty = r.QUANTITY

    scored: List[Dict[str, Any]] = []

    for p in products:

        cat = (p.CATEGORY or "").strip().lower()

        score = 0.0

        rationale_bits: List[str] = []

        if cat and cat in biz_cats:

            score += 60

            rationale_bits.append(
                f"matches {customer.BUSINESS_TYPE or 'your sector'}"
            )

        if cat and cat in req_cats:

            score += 25

            rationale_bits.append("aligns with your requirements")

        build_days = p.ESTIMATED_BUILD_DAYS or 14

        # Faster builds get up to 15 bonus pts (7 days = 15, 30+ = 0)
        speed_bonus = max(0.0, min(15.0, (30 - build_days) * 0.65))

        score += speed_bonus

        if build_days <= 10:

            rationale_bits.append(f"quick {build_days}-day build")

        if not rationale_bits:

            rationale_bits.append(
                "general-purpose fit from our active catalogue"
            )

        scored.append({
            "product_model_id": p.ID,
            "score": round(score, 1),
            "rationale": ", ".join(rationale_bits).capitalize() + ".",
            "suggested_quantity": req_qty,
            "optional_features": [],
            "suggested_amc_plan": (
                "STANDARD_2Y" if req_qty >= 3 else "BASIC_1Y"
            ),
        })

    scored.sort(key=lambda r: r["score"], reverse=True)

    return scored[:top_k]


# ----------------------------------------------------------------
# Public entrypoint
# ----------------------------------------------------------------

def recommend_products(
    db: Session,
    customer_id: Optional[int] = None,
    requirements_text: Optional[str] = None,
    vendor_id: int = 1,
    top_k: int = 3,
) -> Dict[str, Any]:
    """Rank the vendor's active ProductModels for a given customer
    and/or free-text requirement.

    At least one of `customer_id` or `requirements_text` should be
    provided — the route layer enforces this.

    Returns a structured dict (see schema reference at the top of
    this file). Never raises — Gemini failures degrade to a
    deterministic category-based ranking.
    """

    if top_k is None or top_k < 1:

        top_k = 3

    if top_k > 10:

        top_k = 10

    # ---- Load customer + requirements (best-effort) ----
    customer: Optional[Customer] = None

    requirements: List[CustomerRequirement] = []

    if customer_id:

        customer = db.query(Customer).filter(
            Customer.ID == customer_id
        ).first()

        if customer:

            requirements = db.query(CustomerRequirement).filter(
                CustomerRequirement.CUSTOMER_ID == customer_id
            ).all()

    # ---- Load product candidate pool (active, vendor-scoped) ----
    products: List[ProductModel] = db.query(ProductModel).filter(
        ProductModel.VENDOR_ID == vendor_id,
        ProductModel.STATUS == "ACTIVE",
    ).all()

    if not products:

        return {
            "recommendations": [],
            "summary": (
                "No active products are available in the catalogue for "
                "this vendor — please add a ProductModel first."
            ),
            "gemini_model_used": None,
            "source": "fallback",
        }

    # ---- Build prompt + ask Gemini ----
    prompt = _build_prompt(
        customer_ctx=_serialize_customer(customer),
        requirements=_serialize_requirements(requirements),
        requirements_text=requirements_text or "",
        products=[_serialize_product(p) for p in products],
        top_k=top_k,
    )

    gemini_out = _call_gemini(prompt)

    parsed = gemini_out.get("parsed")

    if isinstance(parsed, dict):

        recs_raw = parsed.get("recommendations") or []

        valid_ids = {p.ID for p in products}

        cleaned: List[Dict[str, Any]] = []

        for r in recs_raw[:top_k]:

            if not isinstance(r, dict):

                continue

            try:

                pid = int(r.get("product_model_id"))

            except (TypeError, ValueError):

                continue

            if pid not in valid_ids:

                continue

            try:

                score = float(r.get("score", 0))

            except (TypeError, ValueError):

                score = 0.0

            score = max(0.0, min(100.0, score))

            try:

                sug_qty = int(r.get("suggested_quantity", 1))

            except (TypeError, ValueError):

                sug_qty = 1

            opt_feats = r.get("optional_features") or []

            if not isinstance(opt_feats, list):

                opt_feats = []

            cleaned.append({
                "product_model_id": pid,
                "score": round(score, 1),
                "rationale": str(r.get("rationale") or "").strip(),
                "suggested_quantity": max(1, sug_qty),
                "optional_features": [
                    str(f).strip() for f in opt_feats if f
                ],
                "suggested_amc_plan": str(
                    r.get("suggested_amc_plan") or "BASIC_1Y"
                ).strip(),
            })

        if cleaned:

            cleaned.sort(key=lambda r: r["score"], reverse=True)

            return {
                "recommendations": cleaned,
                "summary": str(parsed.get("summary") or "").strip(),
                "gemini_model_used": gemini_out.get("model_used"),
                "source": "gemini",
            }

    # ---- Gemini unavailable or returned nothing usable → fallback ----
    fallback = _fallback_rank(customer, requirements, products, top_k)

    return {
        "recommendations": fallback,
        "summary": (
            "Heuristic ranking based on category match against the "
            "customer's business sector and stated requirements. "
            "AI service was unavailable for a richer rationale."
        ),
        "gemini_model_used": None,
        "source": "fallback",
    }
