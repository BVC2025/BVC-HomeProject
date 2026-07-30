"""Function-calling tools for the customer-facing WhatsApp sales assistant
(MODULE_CODE = "lead_module"). Kept in its own file (not the internal
"lead" module's tools.py, which stays TOOLS = [] and unmodified) so the
internal staff assistant's behaviour is provably unaffected by this feature.

Every tool is a read-only SELECT except request_human_callback — a
deliberate structural enforcement of the "AI is advisory-only, never
finalizes a deal" product decision: there is no create/update tool for
Quotation or ProjectPricing, so the model has no way to write one even if a
prompt-injection attempt asked it to.

VENDOR_ID (and SOURCE_RECORD_ID/CONVERSATION_ID where relevant) come from the
server-side `context` dict passed to resolve() — never from the model's own
tool-call arguments — so a malicious or confused prompt cannot cross a
tenant boundary."""
import os
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.project_models import Project, ProjectCategory, ProjectPricing
from app.models.project_quotation_models import ProjectQuotationTemplate
from app.models.whatsapp_models import WhatsAppConversation


def _pricing_summary(pricing: Optional[ProjectPricing]) -> Optional[dict]:
    if not pricing or not pricing.IS_ACTIVE:
        return None
    return {
        "currency": pricing.CURRENCY,
        "list_price": float(pricing.ORIGINAL_PRICE or 0),
        "packing_charge": float(pricing.PACKING_CHARGE or 0),
        "transportation_charge": float(pricing.TRANSPORTATION_CHARGE or 0),
        "installation_charge": float(pricing.INSTALLATION_CHARGE or 0),
        "service_charge": float(pricing.SERVICE_CHARGE or 0),
        "additional_charges": float(pricing.ADDITIONAL_CHARGES or 0),
        "tax_amount": float(pricing.TAX_AMOUNT or 0),
        "discount_amount": float(pricing.DISCOUNT_AMOUNT or 0),
        "final_price": float(pricing.FINAL_PRICE or 0),
    }


def tool_list_vending_projects(db: Session, context: dict, category: Optional[str] = None, limit: int = 8) -> dict:
    """Lists available vending-machine projects, optionally filtered by category."""
    vendor_id = context["vendor_id"]
    q = db.query(Project).filter(Project.VENDOR_ID == vendor_id)
    if category:
        q = q.join(ProjectCategory, Project.CATEGORY_ID == ProjectCategory.ID).filter(
            ProjectCategory.NAME.ilike(f"%{category}%")
        )
    projects = q.order_by(Project.NAME).limit(max(1, min(limit, 20))).all()

    results = []
    for p in projects:
        pricing = db.query(ProjectPricing).filter(ProjectPricing.PROJECT_ID == p.ID).first()
        results.append({
            "name": p.NAME,
            "category": p.category.NAME if p.category else None,
            "description": p.DESCRIPTION,
            "estimated_days": float(p.ESTIMATED_TOTAL_DAYS or 0),
            "pricing": _pricing_summary(pricing),
        })
    return {"projects": results}


def tool_get_project_details(db: Session, context: dict, project_name: str) -> dict:
    """Full detail for one project by name (fuzzy match)."""
    vendor_id = context["vendor_id"]
    project = (
        db.query(Project)
        .filter(Project.VENDOR_ID == vendor_id, Project.NAME.ilike(f"%{project_name}%"))
        .order_by(Project.NAME)
        .first()
    )
    if not project:
        alternatives = [
            p.NAME for p in db.query(Project).filter(Project.VENDOR_ID == vendor_id).limit(10).all()
        ]
        return {"error": f"No project found matching '{project_name}'", "did_you_mean": alternatives}

    pricing = db.query(ProjectPricing).filter(ProjectPricing.PROJECT_ID == project.ID).first()
    quotation = db.query(ProjectQuotationTemplate).filter(ProjectQuotationTemplate.PROJECT_ID == project.ID).first()
    return {
        "name": project.NAME,
        "category": project.category.NAME if project.category else None,
        "description": project.DESCRIPTION,
        "estimated_days": float(project.ESTIMATED_TOTAL_DAYS or 0),
        "pricing": _pricing_summary(pricing),
        "quotation_available": quotation is not None,
    }


def tool_suggest_projects(db: Session, context: dict, requirement_text: str,
                           budget_max: Optional[float] = None, limit: int = 3) -> dict:
    """Suggests projects matching a free-text customer requirement, ranked by
    keyword overlap. Deterministic — no nested LLM call, so latency stays
    bounded."""
    vendor_id = context["vendor_id"]
    keywords = [w.lower() for w in requirement_text.split() if len(w) > 2]

    projects = db.query(Project).filter(Project.VENDOR_ID == vendor_id).all()

    scored = []
    for p in projects:
        haystack = " ".join(filter(None, [p.NAME, p.DESCRIPTION, p.category.NAME if p.category else None])).lower()
        score = sum(1 for kw in keywords if kw in haystack)
        pricing = db.query(ProjectPricing).filter(ProjectPricing.PROJECT_ID == p.ID).first()
        final_price = float(pricing.FINAL_PRICE) if (pricing and pricing.IS_ACTIVE) else None
        if budget_max is not None and final_price is not None and final_price > budget_max:
            continue
        scored.append((score, p, final_price))

    scored.sort(key=lambda t: t[0], reverse=True)
    top = scored[:max(1, min(limit, 10))]

    return {
        "suggestions": [
            {
                "name": p.NAME,
                "category": p.category.NAME if p.category else None,
                "description": p.DESCRIPTION,
                "final_price": price,
                "match_reason": f"{score} keyword match(es) with your requirement" if score else "closest available option",
            }
            for score, p, price in top
        ]
    }


def tool_check_price_offer(db: Session, context: dict, project_name: str, offered_price: float,
                            quantity: int = 1) -> dict:
    """Checks a customer's price offer against the project's negotiation
    bounds WITHOUT ever revealing the actual floor number to the model —
    only an acceptable/not + a safe counter-price is returned. This is a
    structural guardrail: no prompt-injection can extract a floor the model
    was never given."""
    vendor_id = context["vendor_id"]
    project = (
        db.query(Project)
        .filter(Project.VENDOR_ID == vendor_id, Project.NAME.ilike(f"%{project_name}%"))
        .first()
    )
    if not project:
        return {"error": f"No project found matching '{project_name}'"}

    pricing = db.query(ProjectPricing).filter(ProjectPricing.PROJECT_ID == project.ID).first()
    if not pricing or not pricing.IS_ACTIVE:
        return {"error": "No active pricing configured for this project — please involve a human sales rep."}

    list_price = float(pricing.FINAL_PRICE or pricing.ORIGINAL_PRICE or 0) * max(1, quantity)
    min_price = float(pricing.MINIMUM_NEGOTIATION_PRICE) if pricing.MINIMUM_NEGOTIATION_PRICE is not None else 0.0
    pct_floor = float(pricing.ORIGINAL_PRICE or 0) * (1 - float(pricing.NEGOTIATION_PERCENT or 0) / 100.0) * max(1, quantity)
    floor = max(min_price, pct_floor)

    try:
        offered = float(offered_price)
    except (TypeError, ValueError):
        return {"error": "offered_price must be a number"}

    acceptable = offered >= floor
    counter = None if acceptable else round(max(floor, offered) / 100.0) * 100.0

    return {
        "currency": pricing.CURRENCY,
        "list_price": list_price,
        "acceptable": acceptable,
        "counter_price": None if acceptable else counter,
    }


def tool_get_quotation_summary(db: Session, context: dict, project_name: str) -> dict:
    """Whether a formal quotation document exists for this project — the
    document content itself is opaque (frontend-owned layout), so this only
    reports its identity, not line items."""
    vendor_id = context["vendor_id"]
    project = (
        db.query(Project)
        .filter(Project.VENDOR_ID == vendor_id, Project.NAME.ilike(f"%{project_name}%"))
        .first()
    )
    if not project:
        return {"error": f"No project found matching '{project_name}'"}

    quotation = db.query(ProjectQuotationTemplate).filter(ProjectQuotationTemplate.PROJECT_ID == project.ID).first()
    if not quotation:
        return {"available": False}

    return {
        "available": True,
        "quotation_number": quotation.QUOTATION_NUMBER,
        "quotation_date": quotation.QUOTATION_DATE.isoformat() if quotation.QUOTATION_DATE else None,
    }


def tool_send_quotation_pdf(db: Session, context: dict, project_name: str) -> dict:
    """Sends the project's existing quotation PDF as a WhatsApp document
    message. Reuses the existing, already-built PDF renderer at
    GET /projects/{id}/quotation/pdf (backend/app/routes/project_quotation.py)
    via its public URL — no new PDF-generation code. Read-only from the
    ERP's perspective: this never creates or edits a Quotation/ProjectPricing
    row, only shares an existing per-project document that already exists
    independent of any customer negotiation."""
    vendor_id = context["vendor_id"]
    conversation_id = context.get("conversation_id")
    if not conversation_id:
        return {"ok": False, "error": "no active conversation to send to"}

    project = (
        db.query(Project)
        .filter(Project.VENDOR_ID == vendor_id, Project.NAME.ilike(f"%{project_name}%"))
        .first()
    )
    if not project:
        return {"ok": False, "error": f"No project found matching '{project_name}'"}

    quotation = db.query(ProjectQuotationTemplate).filter(ProjectQuotationTemplate.PROJECT_ID == project.ID).first()
    if not quotation:
        return {"ok": False, "error": "No quotation document available for this project yet — a sales rep will follow up with pricing details."}

    conv = db.query(WhatsAppConversation).filter(WhatsAppConversation.ID == conversation_id).first()
    if not conv:
        return {"ok": False, "error": "conversation not found"}

    backend_base = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
    media_url = f"{backend_base}/projects/{project.ID}/quotation/pdf"

    from app.services import whatsapp_outbox_service
    msg = whatsapp_outbox_service.enqueue_document_message(
        db, vendor_id, conv.WA_ID, media_url, purpose="QUOTATION_PDF",
        filename=f"{project.NAME} - Quotation.pdf",
        caption=f"Here's our quotation for {project.NAME}.",
        module_code=conv.MODULE_CODE or "lead_module",
    )
    if not msg:
        return {"ok": False, "error": "Could not queue the quotation document — please try again shortly."}

    return {"ok": True, "message": "Quotation PDF queued for delivery."}


def tool_request_human_callback(db: Session, context: dict, reason: str) -> dict:
    """The only write tool — flags this conversation for a human sales rep to
    take over. Never touches Quotation or ProjectPricing."""
    conversation_id = context.get("conversation_id")
    if not conversation_id:
        return {"ok": False, "error": "no active conversation to flag"}

    conv = db.query(WhatsAppConversation).filter(WhatsAppConversation.ID == conversation_id).first()
    if not conv:
        return {"ok": False, "error": "conversation not found"}

    conv.NEEDS_HUMAN = True
    conv.HANDOFF_REASON = (reason or "Customer requested human assistance")[:300]
    db.commit()
    return {"ok": True}


TOOL_REGISTRY: Dict[str, dict] = {
    "list_vending_projects": {
        "fn": tool_list_vending_projects,
        "decl": {
            "name": "list_vending_projects",
            "description": "Lists available vending-machine projects for this vendor, optionally filtered by category.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Optional category name filter"},
                    "limit": {"type": "integer", "description": "Max results, default 8"},
                },
            },
        },
    },
    "get_project_details": {
        "fn": tool_get_project_details,
        "decl": {
            "name": "get_project_details",
            "description": "Full details (description, estimated days, pricing breakdown) for one vending-machine project by name.",
            "parameters": {
                "type": "object",
                "properties": {"project_name": {"type": "string"}},
                "required": ["project_name"],
            },
        },
    },
    "suggest_projects": {
        "fn": tool_suggest_projects,
        "decl": {
            "name": "suggest_projects",
            "description": "Suggests suitable vending-machine projects based on a customer's free-text requirement and optional budget.",
            "parameters": {
                "type": "object",
                "properties": {
                    "requirement_text": {"type": "string", "description": "What the customer said they need"},
                    "budget_max": {"type": "number", "description": "Optional maximum budget"},
                    "limit": {"type": "integer", "description": "Max suggestions, default 3"},
                },
                "required": ["requirement_text"],
            },
        },
    },
    "check_price_offer": {
        "fn": tool_check_price_offer,
        "decl": {
            "name": "check_price_offer",
            "description": (
                "Checks whether a customer's offered price for a project is acceptable within the "
                "company's negotiation bounds, and if not, returns a safe counter-price. Use this "
                "instead of guessing at pricing during negotiation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_name": {"type": "string"},
                    "offered_price": {"type": "number"},
                    "quantity": {"type": "integer", "description": "Default 1"},
                },
                "required": ["project_name", "offered_price"],
            },
        },
    },
    "get_quotation_summary": {
        "fn": tool_get_quotation_summary,
        "decl": {
            "name": "get_quotation_summary",
            "description": "Checks whether a formal quotation document exists for a project.",
            "parameters": {
                "type": "object",
                "properties": {"project_name": {"type": "string"}},
                "required": ["project_name"],
            },
        },
    },
    "send_quotation_pdf": {
        "fn": tool_send_quotation_pdf,
        "decl": {
            "name": "send_quotation_pdf",
            "description": (
                "Sends the existing quotation PDF for a project to the customer over WhatsApp. "
                "Use this when the customer asks for a quotation, price list, or formal document for a project."
            ),
            "parameters": {
                "type": "object",
                "properties": {"project_name": {"type": "string"}},
                "required": ["project_name"],
            },
        },
    },
    "request_human_callback": {
        "fn": tool_request_human_callback,
        "decl": {
            "name": "request_human_callback",
            "description": (
                "Flags the conversation so a human sales representative follows up — use when the "
                "customer wants to finalize a deal, has a complaint, or asks something outside your knowledge."
            ),
            "parameters": {
                "type": "object",
                "properties": {"reason": {"type": "string"}},
                "required": ["reason"],
            },
        },
    },
}

TOOLS: List[dict] = [t["decl"] for t in TOOL_REGISTRY.values()]


def resolve(name: str, args: dict, db: Session, context: dict) -> dict:
    """Single dispatch entry point. Returns a JSON-safe dict; any exception
    from a tool is caught here so a broken tool degrades the model's answer
    instead of crashing the turn."""
    tool = TOOL_REGISTRY.get(name)
    if not tool:
        return {"error": f"unknown tool: {name}"}
    try:
        return tool["fn"](db=db, context=context, **(args or {}))
    except Exception as e:
        return {"error": str(e)}
