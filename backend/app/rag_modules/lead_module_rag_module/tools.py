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
import difflib
import os
import re
import secrets
from urllib.parse import quote as _urlquote
from typing import Dict, List, NamedTuple, Optional

from sqlalchemy.orm import Session

from app.models.project_models import Project, ProjectCategory, ProjectPricing
from app.models.project_quotation_models import ProjectQuotationTemplate
from app.models.whatsapp_models import WhatsAppConversation
from app.models.models import CompanyMaster
from app.rag_modules.core import negotiation_engine

# ── Generic, catalog-agnostic project-name resolution ───────────────────────
# Replaces a naive NAME.ilike('%name%') lookup (which requires the model's
# entire guessed phrase to be a contiguous substring of the real name — real
# customer phrasing essentially never satisfies that against a real catalog
# entry) with a resolution ladder: exact -> substring -> fuzzy token-coverage.
# Stdlib-only (difflib), no new dependency, no vendor/project-specific tuning
# needed as the catalog grows.

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Two words count as "the same word" at/above this similarity. Calibrated
# against real data: snacks/snaks ~0.91, vending/vendng ~0.92 pass;
# coffee/machine ~0.31, juice/machine ~0.33 fail.
_TOKEN_SIM = 0.80

# The best fuzzy candidate must beat the runner-up by this margin, or the
# request is treated as genuinely ambiguous (e.g. two projects sharing a name
# across categories) rather than guessed.
_AMBIGUITY_MARGIN = 0.08

_MAX_SUGGESTIONS = 5


class ProjectMatch(NamedTuple):
    """project is None when nothing resolved confidently; suggestions is
    always the best-ranked distinct names available (drives did_you_mean and
    the model's retry, per prompts.py's retry-with-suggestion rule)."""
    project: Optional[Project]
    suggestions: List[str]
    reason: str  # exact | substring | fuzzy | ambiguous | no_match | no_projects | empty_query


def _norm(s: Optional[str]) -> str:
    """Lowercase, drop punctuation, collapse whitespace."""
    return " ".join(_TOKEN_RE.findall((s or "").lower()))


def _tokens(s: Optional[str]) -> List[str]:
    """Content words. Tokens under 3 chars are dropped as noise (of, for, a,
    to) UNLESS they contain a digit — capacity/model numbers are identity-
    bearing and must never be discarded."""
    return [t for t in _TOKEN_RE.findall((s or "").lower())
            if len(t) >= 3 or any(c.isdigit() for c in t)]


def _same_word(a: str, b: str) -> bool:
    # Numeric tokens must match EXACTLY — difflib rates "500" vs "5000" at
    # 0.857, which would otherwise silently swap one machine's price/specs
    # for a differently-sized one.
    if any(c.isdigit() for c in a) or any(c.isdigit() for c in b):
        return a == b
    if a == b:
        return True
    if len(a) >= 4 and len(b) >= 4 and (a in b or b in a):
        return True  # stem/plural: vend~vending, machine~machines
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio() >= _TOKEN_SIM


def match_project(db: Session, vendor_id, project_name: str,
                   suggestion_limit: int = _MAX_SUGGESTIONS) -> ProjectMatch:
    """Resolves a customer-phrased project name to exactly one Project row
    for this vendor, or to None plus ranked alternatives. vendor_id always
    comes from the server-side context — never from model tool arguments —
    so tenant isolation is unchanged from every other tool in this module.

    Resolution ladder, most-certain first:
      1. exact     — normalized equality
      2. substring — normalized containment in either direction (a superset
                     of the old ilike behavior — nothing that matched before
                     stops matching)
      3. fuzzy      — per-token coverage; accepted only if one side's content
                     words are fully covered by the other's, and the best
                     candidate beats the runner-up by _AMBIGUITY_MARGIN
      otherwise    — None + ranked suggestions
    """
    q_norm = _norm(project_name)
    q_tokens = _tokens(project_name)

    candidates = (
        db.query(Project)
        .filter(Project.VENDOR_ID == vendor_id)
        .order_by(Project.NAME, Project.ID)
        .all()
    )
    if not candidates:
        return ProjectMatch(None, [], "no_projects")

    def _suggest(ranked: List[Project]) -> List[str]:
        out, seen = [], set()
        for p in ranked:
            key = _norm(p.NAME)
            if key and key not in seen:
                seen.add(key)
                out.append(p.NAME)
            if len(out) >= max(1, suggestion_limit):
                break
        return out

    scored = []  # (score, qc, nc, project)
    for p in candidates:
        n_norm = _norm(p.NAME)
        n_tokens = _tokens(p.NAME)
        qc = (sum(1 for t in q_tokens if any(_same_word(t, u) for u in n_tokens))
              / len(q_tokens)) if q_tokens else 0.0
        nc = (sum(1 for u in n_tokens if any(_same_word(u, t) for t in q_tokens))
              / len(n_tokens)) if n_tokens else 0.0
        seq = difflib.SequenceMatcher(None, q_norm, n_norm, autojunk=False).ratio()
        f1 = (2 * qc * nc / (qc + nc)) if (qc + nc) else 0.0
        scored.append((0.5 * f1 + 0.5 * seq, qc, nc, p))

    scored.sort(key=lambda t: (-t[0], len(t[3].NAME or ""), t[3].NAME or "", t[3].ID))
    ranked = [t[3] for t in scored]
    suggestions = _suggest(ranked)

    if not q_norm or not q_tokens:
        return ProjectMatch(None, suggestions, "empty_query")

    for p in candidates:
        if _norm(p.NAME) == q_norm:
            return ProjectMatch(p, suggestions, "exact")

    subs = [p for p in candidates
            if q_norm in _norm(p.NAME) or _norm(p.NAME) in q_norm]
    if subs:
        best = min(subs, key=lambda p: (abs(len(_norm(p.NAME)) - len(q_norm)),
                                        len(p.NAME or ""), p.NAME or "", p.ID))
        return ProjectMatch(best, suggestions, "substring")

    passers = [t for t in scored if t[1] >= 0.999 or t[2] >= 0.999]
    if not passers:
        return ProjectMatch(None, suggestions, "no_match")

    best = passers[0]
    if len(passers) > 1:
        runner_up = passers[1]
        if (_norm(runner_up[3].NAME) != _norm(best[3].NAME)
                and (best[0] - runner_up[0]) < _AMBIGUITY_MARGIN):
            return ProjectMatch(None, _suggest([t[3] for t in passers]), "ambiguous")

    return ProjectMatch(best[3], suggestions, "fuzzy")


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
    match = match_project(db, vendor_id, project_name)
    if not match.project:
        return {"error": f"No project found matching '{project_name}'", "did_you_mean": match.suggestions}
    project = match.project

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


def tool_check_price_offer(db: Session, context: dict, project_name: str,
                            offered_price: Optional[float] = None, quantity: int = 1) -> dict:
    """Checks a customer's price offer against the project's negotiation
    bounds WITHOUT ever revealing the actual floor number to the model —
    only an acceptable/not + a safe counter-price is returned. This is a
    structural guardrail: no prompt-injection can extract a floor the model
    was never given.

    offered_price is optional: call this with just project_name for a plain
    "what's the price" question (returns the list price, no comparison) —
    only pass offered_price when the customer has proposed their own number
    to negotiate against. (get_project_details also returns pricing and is
    the simpler choice for a plain price question — either works.)"""
    vendor_id = context["vendor_id"]
    match = match_project(db, vendor_id, project_name)
    if not match.project:
        return {"error": f"No project found matching '{project_name}'", "did_you_mean": match.suggestions}
    project = match.project

    pricing = db.query(ProjectPricing).filter(ProjectPricing.PROJECT_ID == project.ID).first()
    if not pricing or not pricing.IS_ACTIVE:
        return {"error": "No active pricing configured for this project — please involve a human sales rep."}

    list_price = float(pricing.FINAL_PRICE or pricing.ORIGINAL_PRICE or 0) * max(1, quantity)

    if offered_price is None:
        return {
            "project_name": project.NAME,
            "currency": pricing.CURRENCY,
            "list_price": list_price,
        }

    try:
        offered = float(offered_price)
    except (TypeError, ValueError):
        return {"error": "offered_price must be a number"}

    min_price = float(pricing.MINIMUM_NEGOTIATION_PRICE) if pricing.MINIMUM_NEGOTIATION_PRICE is not None else 0.0

    # Deterministic, server-side round/counter tracking — never inferred
    # from raw chat history, never left to the LLM to remember. See
    # negotiation_engine.evaluate_offer's docstring for the full algorithm
    # (compounding reduction, floor clamp, natural rounding, monotonic
    # never-increase guarantee).
    result = negotiation_engine.evaluate_offer(
        db, context.get("session_id"), context.get("module_code", "lead_module"), project.ID,
        list_price, min_price, pricing.NEGOTIATION_PERCENT, offered,
    )

    return {
        "project_name": project.NAME,
        "currency": pricing.CURRENCY,
        "list_price": list_price,
        "acceptable": result["acceptable"],
        "counter_price": result["counter_price"],
    }


def tool_get_quotation_summary(db: Session, context: dict, project_name: str) -> dict:
    """Whether a formal quotation document exists for this project — the
    document content itself is opaque (frontend-owned layout), so this only
    reports its identity, not line items."""
    vendor_id = context["vendor_id"]
    match = match_project(db, vendor_id, project_name)
    if not match.project:
        return {"error": f"No project found matching '{project_name}'", "did_you_mean": match.suggestions}
    project = match.project

    quotation = db.query(ProjectQuotationTemplate).filter(ProjectQuotationTemplate.PROJECT_ID == project.ID).first()
    if not quotation:
        return {"project_name": project.NAME, "available": False}

    return {
        "project_name": project.NAME,
        "available": True,
        "quotation_number": quotation.QUOTATION_NUMBER,
        "quotation_date": quotation.QUOTATION_DATE.isoformat() if quotation.QUOTATION_DATE else None,
    }


def tool_send_quotation_pdf(db: Session, context: dict, project_name: str) -> dict:
    """Shares the project's existing quotation PDF — as a WhatsApp document
    message when this turn belongs to a real WhatsApp conversation, or as a
    direct link when it doesn't (e.g. an internal/Playground test chat with
    no conversation to push a document into). Reuses the existing,
    already-built PDF renderer, but via the PUBLIC, token-secured
    GET /quotation-pdf/{token} endpoint (backend/app/routes/
    project_quotation.py) — not the internal GET /projects/{id}/quotation/
    pdf, which is RBAC-gated and unreachable by a customer's browser or by
    Meta's own servers fetching the media URL to relay as a WhatsApp
    document. No new PDF-generation code either way. Read-only from the
    ERP's business-data perspective: this never creates or edits a
    Quotation/ProjectPricing row, only shares an existing per-project
    document that already exists independent of any customer negotiation
    — the one write it does make (SHARE_TOKEN, below) carries no price/
    content/negotiation meaning, purely a sharing mechanism."""
    vendor_id = context["vendor_id"]
    conversation_id = context.get("conversation_id")

    match = match_project(db, vendor_id, project_name)
    if not match.project:
        return {"ok": False, "error": f"No project found matching '{project_name}'", "did_you_mean": match.suggestions}
    project = match.project

    quotation = db.query(ProjectQuotationTemplate).filter(ProjectQuotationTemplate.PROJECT_ID == project.ID).first()
    if not quotation:
        return {"ok": False, "error": "No quotation document available for this project yet — a sales rep will follow up with pricing details."}

    # Generated once, on first share, and reused after — mirrors
    # get_or_create_purchase_order_row()'s identical UPLOAD_TOKEN idiom.
    if not quotation.SHARE_TOKEN:
        quotation.SHARE_TOKEN = secrets.token_urlsafe(32)
        db.commit()

    backend_base = os.getenv("BACKEND_URL", "http://localhost:8001").rstrip("/")
    media_url = f"{backend_base}/quotation-pdf/{quotation.SHARE_TOKEN}"

    if not conversation_id:
        friendly_name = f"{project.NAME} - Quotation"
        link = f"{media_url}?filename={_urlquote(friendly_name)}"
        return {"ok": True, "project_name": project.NAME, "pdf_url": link, "delivery": "link"}

    conv = db.query(WhatsAppConversation).filter(WhatsAppConversation.ID == conversation_id).first()
    if not conv:
        return {"ok": False, "error": "conversation not found"}

    from app.services import whatsapp_outbox_service
    msg = whatsapp_outbox_service.enqueue_document_message(
        db, vendor_id, conv.WA_ID, media_url, purpose="QUOTATION_PDF",
        filename=f"{project.NAME} - Quotation.pdf",
        caption=f"Here's our quotation for {project.NAME}.",
        module_code=conv.MODULE_CODE or "lead_module",
    )
    if not msg:
        return {"ok": False, "error": "Could not queue the quotation document — please try again shortly."}

    return {"ok": True, "project_name": project.NAME, "message": "Quotation PDF queued for delivery.", "delivery": "whatsapp"}


def tool_get_company_info(db: Session, context: dict) -> dict:
    """The vendor's official company/contact details (legal name, tagline,
    address, email, phone, website) — a structured source of truth for
    company/contact questions, instead of relying only on whatever prose
    happens to be in the uploaded knowledge-base document. Read-only;
    mirrors get_quotation_summary's "not configured yet" shape when the
    vendor hasn't filled one in."""
    vendor_id = context["vendor_id"]
    company = db.query(CompanyMaster).filter(CompanyMaster.VENDOR_ID == vendor_id).first()
    if not company:
        return {"available": False}

    address_parts = [
        company.ADDRESS_LINE_1, company.ADDRESS_LINE_2,
        company.CITY, company.STATE, company.PINCODE, company.COUNTRY,
    ]
    address = ", ".join(p for p in address_parts if p) or None

    return {
        "available": True,
        "legal_name": company.LEGAL_NAME,
        "short_name": company.SHORT_NAME,
        "tagline": company.TAGLINE,
        "address": address,
        "email": company.EMAIL,
        "phone": company.PHONE,
        "website": company.WEBSITE,
    }


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
                "Gets the price for a project, and — if the customer has proposed their own price — "
                "checks whether it's acceptable within the company's negotiation bounds and returns a "
                "safe counter-price if not. Omit offered_price for a plain 'what's the price' question; "
                "only include it when the customer has stated their own specific offer to negotiate against."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project_name": {"type": "string"},
                    "offered_price": {
                        "type": "number",
                        "description": "Only set this if the customer proposed their own price to negotiate.",
                    },
                    "quantity": {"type": "integer", "description": "Default 1"},
                },
                "required": ["project_name"],
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
    "get_company_info": {
        "fn": tool_get_company_info,
        "decl": {
            "name": "get_company_info",
            "description": (
                "The vendor's official company name, tagline, address, email, phone, and website. "
                "Use this whenever the customer asks for the company's real name, contact details, "
                "address, or website — never guess these from memory."
            ),
            "parameters": {"type": "object", "properties": {}},
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
