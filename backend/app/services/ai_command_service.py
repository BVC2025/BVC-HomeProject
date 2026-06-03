"""Admin Module 5 — AI Command Center.

Natural-language queries → live ERP data answers.

Two-tier intent resolution:
  1. Fast keyword/phrase router (deterministic, free, no LLM round-trip)
  2. Gemini fallback for fuzzy queries that don't match a pattern

Each intent maps to a `tool function` that returns:
  {
    "intent":   "low_stock_inventory",
    "answer":   "short human sentence",
    "data":     { kind: "table"|"list"|"number"|..., rows: [...] },
    "suggestions": ["next query 1", "next query 2"]
  }
"""

from datetime import date, datetime, timedelta
from typing import Optional
import logging
import os
import re

from sqlalchemy import func, extract
from sqlalchemy.orm import Session

log = logging.getLogger("bvc24.ai")
log.setLevel(logging.INFO)
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[AI %(levelname)s] %(message)s"))
    log.addHandler(_h)
    log.propagate = False

from app.models.models import (
    Customer,
    Quotation,
    SalesOrder,
    Project,
    PurchaseOrder,
    Inventory,
    Attendance,
    LeaveRequest,
    WorkOrder,
    Notification,
    Employee,
    Task,
    TaskAssignment,
)


# ---- Helpers ---------------------------------------------------------

def _fmt_money(n) -> str:

    v = float(n or 0.0)

    if abs(v) >= 1_00_00_000:

        return f"₹{v/1_00_00_000:.2f} Cr"

    if abs(v) >= 1_00_000:

        return f"₹{v/1_00_000:.2f} L"

    if abs(v) >= 1_000:

        return f"₹{v/1_000:.1f}K"

    return f"₹{v:,.0f}"


def _today() -> date:

    return date.today()


# ---- Tool functions --------------------------------------------------

def tool_pending_quotations(db: Session) -> dict:

    rows = db.query(Quotation).filter(
        Quotation.STATUS.in_(["DRAFT", "SENT", "NEGOTIATION"])
    ).order_by(Quotation.ID.desc()).limit(10).all()

    total = db.query(func.count(Quotation.ID)).filter(
        Quotation.STATUS.in_(["DRAFT", "SENT", "NEGOTIATION"])
    ).scalar() or 0

    table_rows = []

    for q in rows:

        cust = (
            db.query(Customer).filter(Customer.ID == q.CUSTOMER_ID).first()
            if q.CUSTOMER_ID else None
        )

        table_rows.append({
            "label": q.QUOTATION_NUMBER or f"Quote #{q.ID}",
            "subtitle": (cust.CUSTOMER_NAME if cust else "—") + f" · {q.STATUS}",
            "value": _fmt_money(q.GRAND_TOTAL),
        })

    answer = (
        f"You have **{total}** pending quotation(s)"
        + (f" (showing top {len(rows)})." if total > len(rows) else ".")
    )

    if total == 0:

        answer = "No pending quotations right now — all are converted, approved, or rejected."

    return {
        "intent": "pending_quotations",
        "answer": answer,
        "data": {"kind": "table", "rows": table_rows, "total": total},
        "suggestions": [
            "Show monthly revenue",
            "Which customers have pending quotations?",
        ],
    }


def tool_delayed_projects(db: Session) -> dict:

    today = _today()

    rows = db.query(Project).filter(
        ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"]),
        Project.TARGET_DATE.isnot(None),
        Project.TARGET_DATE < today,
    ).order_by(Project.TARGET_DATE.asc()).limit(15).all()

    table_rows = []

    for p in rows:

        delta = (today - p.TARGET_DATE).days if p.TARGET_DATE else 0

        table_rows.append({
            "label": (p.PROJECT_NAME or f"Project #{p.ID}"),
            "subtitle": (
                f"Due {p.TARGET_DATE.isoformat() if p.TARGET_DATE else '—'}"
                f" · {p.STATUS} · {delta} day(s) late"
            ),
            "value": f"-{delta}d",
        })

    total = len(rows)

    if total == 0:

        answer = "No projects are delayed right now — every active project is on schedule."

    else:

        worst = table_rows[0]

        answer = (
            f"**{total}** project(s) are past their target date. "
            f"Worst case: **{worst['label']}** ({worst['subtitle']})."
        )

    return {
        "intent": "delayed_projects",
        "answer": answer,
        "data": {"kind": "table", "rows": table_rows, "total": total},
        "suggestions": [
            "Show production status",
            "Which work orders are in progress?",
        ],
    }


def tool_low_stock_inventory(db: Session, threshold: int = 10) -> dict:

    rows = db.query(Inventory).filter(
        Inventory.QUANTITY < threshold
    ).order_by(Inventory.QUANTITY.asc()).limit(20).all()

    total = db.query(func.count(Inventory.ID)).filter(
        Inventory.QUANTITY < threshold
    ).scalar() or 0

    table_rows = [
        {
            "label": (r.MATERIAL_NAME or f"Item #{r.ID}"),
            "subtitle": (
                f"₹{float(r.UNIT_PRICE or 0):,.2f} per unit"
                f" · value {_fmt_money(float(r.QUANTITY or 0) * float(r.UNIT_PRICE or 0))}"
            ),
            "value": f"{r.QUANTITY or 0} units",
        }
        for r in rows
    ]

    if total == 0:

        answer = (
            f"All inventory items are above the {threshold}-unit threshold. "
            "No re-stock urgency."
        )

    else:

        answer = (
            f"**{total}** inventory item(s) are below {threshold} units. "
            f"Lowest stock: **{rows[0].MATERIAL_NAME}** "
            f"({rows[0].QUANTITY} left)."
        )

    return {
        "intent": "low_stock_inventory",
        "answer": answer,
        "data": {"kind": "table", "rows": table_rows, "total": total, "threshold": threshold},
        "suggestions": [
            "Show pending purchase orders",
            "Total inventory value?",
        ],
    }


def tool_absent_today(db: Session) -> dict:

    today = _today()

    # All active employees
    active_emps = db.query(Employee).filter(
        Employee.STATUS == "ACTIVE"
    ).all()

    # Today's attendance — anyone with PRESENT/LATE is here
    present_ids = {
        a.EMPLOYEE_ID
        for a in db.query(Attendance).filter(
            Attendance.DATE == today,
            Attendance.STATUS.in_(["PRESENT", "LATE", "HALF_DAY"]),
        ).all()
    }

    # Anyone with APPROVED leave covering today
    on_leave_ids = {
        l.EMPLOYEE_ID
        for l in db.query(LeaveRequest).filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE <= today,
            LeaveRequest.END_DATE >= today,
            LeaveRequest.LEAVE_TYPE != "PERMISSION",
        ).all()
    }

    absent = [
        e for e in active_emps
        if e.ID not in present_ids and e.ID not in on_leave_ids
    ]

    on_leave = [e for e in active_emps if e.ID in on_leave_ids]

    table_rows = [
        {
            "label": e.NAME,
            "subtitle": f"{e.EMPLOYEE_CODE} · No check-in today",
            "value": "absent",
        }
        for e in absent
    ]

    if on_leave:

        table_rows.append({
            "label": "— On approved leave —",
            "subtitle": ", ".join(e.NAME for e in on_leave[:8])
                        + (f", +{len(on_leave)-8} more" if len(on_leave) > 8 else ""),
            "value": f"{len(on_leave)} leave",
        })

    if not absent:

        answer = (
            f"Everyone is accounted for today — **{len(present_ids)}** present"
            + (f", **{len(on_leave)}** on approved leave." if on_leave else ".")
        )

    else:

        answer = (
            f"**{len(absent)}** employee(s) are absent today (no check-in)"
            + (f", plus **{len(on_leave)}** on approved leave." if on_leave else ".")
        )

    return {
        "intent": "absent_today",
        "answer": answer,
        "data": {
            "kind": "table",
            "rows": table_rows,
            "absent_count": len(absent),
            "on_leave_count": len(on_leave),
            "present_count": len(present_ids),
        },
        "suggestions": [
            "Who is present today?",
            "Show pending leave requests",
        ],
    }


def tool_present_today(db: Session) -> dict:

    today = _today()

    rows = db.query(Attendance, Employee).join(
        Employee, Attendance.EMPLOYEE_ID == Employee.ID
    ).filter(
        Attendance.DATE == today,
        Attendance.STATUS.in_(["PRESENT", "LATE", "HALF_DAY"]),
    ).order_by(Attendance.CHECK_IN.asc()).all()

    table_rows = [
        {
            "label": e.NAME,
            "subtitle": (
                f"{e.EMPLOYEE_CODE} · checked in "
                f"{a.CHECK_IN.strftime('%H:%M') if a.CHECK_IN else '?'}"
            ),
            "value": a.STATUS,
        }
        for a, e in rows
    ]

    total = len(rows)

    answer = (
        f"**{total}** employee(s) are present today."
        if total else "Nobody has checked in yet."
    )

    return {
        "intent": "present_today",
        "answer": answer,
        "data": {"kind": "table", "rows": table_rows, "total": total},
        "suggestions": [
            "Who is absent today?",
            "Show late employees",
        ],
    }


def tool_pending_leave(db: Session) -> dict:

    rows = db.query(LeaveRequest, Employee).join(
        Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID
    ).filter(
        LeaveRequest.STATUS == "PENDING_APPROVAL"
    ).order_by(LeaveRequest.CREATED_AT.desc()).limit(20).all()

    table_rows = []

    for lr, emp in rows:

        days_lbl = (
            f"{lr.DURATION_HOURS:g} hr" if (lr.DURATION_HOURS or 0) > 0
            else f"{lr.DAYS or 0:g} day(s)"
        )

        table_rows.append({
            "label": emp.NAME,
            "subtitle": f"{lr.LEAVE_TYPE} · {lr.START_DATE.isoformat() if lr.START_DATE else '?'}",
            "value": days_lbl,
        })

    total = len(rows)

    answer = (
        f"**{total}** leave/permission request(s) pending approval."
        if total else "No leave requests waiting on approval."
    )

    return {
        "intent": "pending_leave",
        "answer": answer,
        "data": {"kind": "table", "rows": table_rows, "total": total},
        "suggestions": ["Who is absent today?", "Show approval center"],
    }


def tool_monthly_revenue(db: Session) -> dict:

    now = datetime.now()

    total = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0)
    ).filter(
        extract("year", SalesOrder.SO_DATE) == now.year,
        extract("month", SalesOrder.SO_DATE) == now.month,
        SalesOrder.STATUS != "CANCELLED",
    ).scalar() or 0.0

    so_count = db.query(func.count(SalesOrder.ID)).filter(
        extract("year", SalesOrder.SO_DATE) == now.year,
        extract("month", SalesOrder.SO_DATE) == now.month,
        SalesOrder.STATUS != "CANCELLED",
    ).scalar() or 0

    answer = (
        f"This month's revenue is **{_fmt_money(total)}** across "
        f"**{so_count}** sales order(s)."
    )

    if total == 0:

        answer = "No revenue recorded for this month yet."

    return {
        "intent": "monthly_revenue",
        "answer": answer,
        "data": {
            "kind": "number",
            "value": _fmt_money(total),
            "raw": float(total),
            "subtitle": f"{so_count} sales order(s)",
        },
        "suggestions": ["Show pending payments", "Show pending quotations"],
    }


def tool_pending_payments(db: Session) -> dict:

    row = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0),
        func.coalesce(func.sum(SalesOrder.ADVANCE_RECEIVED), 0.0),
        func.count(SalesOrder.ID),
    ).filter(
        SalesOrder.STATUS.in_([
            "AWAITING_ADVANCE", "CONFIRMED",
            "IN_PRODUCTION", "SHIPPED", "DELIVERED"
        ])
    ).first()

    gross = float(row[0] or 0)
    paid  = float(row[1] or 0)
    cnt   = int(row[2] or 0)

    outstanding = max(0.0, gross - paid)

    answer = (
        f"**{_fmt_money(outstanding)}** is outstanding across "
        f"**{cnt}** active sales order(s) "
        f"(gross {_fmt_money(gross)}, received {_fmt_money(paid)})."
    )

    if outstanding <= 0:

        answer = "All active sales orders are fully paid."

    return {
        "intent": "pending_payments",
        "answer": answer,
        "data": {
            "kind": "number",
            "value": _fmt_money(outstanding),
            "raw": outstanding,
            "subtitle": f"{cnt} order(s) · gross {_fmt_money(gross)}",
        },
        "suggestions": ["Show monthly revenue", "Show pending quotations"],
    }


def tool_production_status(db: Session) -> dict:

    rows = db.query(WorkOrder.STATUS, func.count(WorkOrder.ID)).group_by(
        WorkOrder.STATUS
    ).all()

    by_status = {s: int(c or 0) for s, c in rows}

    table_rows = [
        {"label": s, "subtitle": "", "value": str(c)}
        for s, c in sorted(by_status.items(), key=lambda x: -x[1])
    ]

    active = by_status.get("PLANNED", 0) + by_status.get("IN_PROGRESS", 0)

    answer = (
        f"**{active}** active work order(s) "
        f"({by_status.get('PLANNED', 0)} planned, "
        f"{by_status.get('IN_PROGRESS', 0)} in-progress). "
        f"{by_status.get('DONE', 0)} done so far."
    )

    return {
        "intent": "production_status",
        "answer": answer,
        "data": {"kind": "table", "rows": table_rows, "total": sum(by_status.values())},
        "suggestions": [
            "Which projects are delayed?",
            "Show low stock inventory",
        ],
    }


def tool_pending_approvals(db: Session) -> dict:

    leaves = db.query(func.count(LeaveRequest.ID)).filter(
        LeaveRequest.STATUS == "PENDING_APPROVAL"
    ).scalar() or 0

    quotes = db.query(func.count(Quotation.ID)).filter(
        Quotation.STATUS.in_(["SENT", "NEGOTIATION"])
    ).scalar() or 0

    pos = db.query(func.count(PurchaseOrder.ID)).filter(
        PurchaseOrder.STATUS == "DRAFT"
    ).scalar() or 0

    total = int(leaves) + int(quotes) + int(pos)

    table_rows = [
        {"label": "Leave / Permission", "subtitle": "Pending approval", "value": str(leaves)},
        {"label": "Quotations",         "subtitle": "Sent / Negotiating", "value": str(quotes)},
        {"label": "Purchase Orders",    "subtitle": "Drafts waiting", "value": str(pos)},
    ]

    answer = (
        f"**{total}** item(s) waiting on your approval — "
        f"{leaves} leave, {quotes} quotation, {pos} PO."
    )

    return {
        "intent": "pending_approvals",
        "answer": answer,
        "data": {"kind": "table", "rows": table_rows, "total": total},
        "suggestions": ["Open the Approval Center", "Show pending leaves"],
    }


def tool_employee_overview(db: Session) -> dict:

    active = db.query(func.count(Employee.ID)).filter(
        Employee.STATUS == "ACTIVE"
    ).scalar() or 0

    total = db.query(func.count(Employee.ID)).scalar() or 0

    today = _today()

    on_leave = db.query(func.count(LeaveRequest.ID)).filter(
        LeaveRequest.STATUS == "APPROVED",
        LeaveRequest.START_DATE <= today,
        LeaveRequest.END_DATE >= today,
        LeaveRequest.LEAVE_TYPE != "PERMISSION",
    ).scalar() or 0

    answer = (
        f"**{active}** active employees out of {total} total "
        f"({on_leave} on approved leave today)."
    )

    return {
        "intent": "employee_overview",
        "answer": answer,
        "data": {
            "kind": "table",
            "rows": [
                {"label": "Active employees", "subtitle": "STATUS=ACTIVE", "value": str(active)},
                {"label": "Total on roll",    "subtitle": "Including inactive", "value": str(total)},
                {"label": "On approved leave today", "subtitle": "", "value": str(on_leave)},
            ],
            "total": active,
        },
        "suggestions": ["Who is absent today?", "Show pending leaves"],
    }


def tool_customer_overview(db: Session) -> dict:

    total = db.query(func.count(Customer.ID)).scalar() or 0

    active_so = db.query(func.count(SalesOrder.ID)).filter(
        SalesOrder.STATUS.in_([
            "CONFIRMED", "IN_PRODUCTION", "AWAITING_ADVANCE", "SHIPPED"
        ])
    ).scalar() or 0

    answer = (
        f"**{total}** customer(s) on file. "
        f"{active_so} sales order(s) currently in progress."
    )

    return {
        "intent": "customer_overview",
        "answer": answer,
        "data": {
            "kind": "number",
            "value": str(total),
            "subtitle": f"{active_so} active sales orders",
        },
        "suggestions": ["Show pending quotations", "Show monthly revenue"],
    }


# ---- Conversational intents (greetings, thanks, help, etc.) --------
# Deterministic, no LLM dependency. Catches small-talk so the
# assistant feels alive even when Gemini quota is exhausted.

DATA_SUGGESTIONS = [
    "Show pending quotations",
    "Which project is delayed?",
    "How much inventory is low stock?",
    "Who is absent today?",
    "Monthly revenue",
    "Production status",
]


def _conv_reply(intent: str, answer: str) -> dict:
    """Wrap a conversational reply in the standard response shape."""

    return {
        "intent": intent,
        "matched_via": "conversation",
        "answer": answer,
        "data": None,
        "suggestions": DATA_SUGGESTIONS[:4],
    }


CONVERSATIONAL_PATTERNS = [
    # Greeting — only fires when greeting is the entire query (or first 1-3 words)
    # to avoid catching "hi could you show me low stock" as a greeting-only.
    (
        r"^(hi|hello|hey|hai|yo|howdy|good\s*(morning|afternoon|evening|day))[\s!.,]*$",
        lambda: _conv_reply(
            "greeting",
            "Hello! 👋 I'm the BVC24 AI assistant. I can answer questions "
            "about your live data — sales, projects, inventory, attendance, "
            "approvals and more. Try one of the chips below or just ask me "
            "in your own words."
        ),
    ),
    # Thanks — fairly safe to match anywhere
    (
        r"^(thanks|thank you|thx|ty|cheers|much appreciated|appreciate it)[\s!.,]*$",
        lambda: _conv_reply(
            "thanks",
            "You're welcome! Let me know if you want to dig into anything else."
        ),
    ),
    # Who are you — exact-phrase match only (so "what are you doing" doesn't fire)
    (
        r"^(who are you|what are you|introduce yourself|tell me about yourself|your name|what'?s your name)[\?\s!.,]*$",
        lambda: _conv_reply(
            "identity",
            "I'm the **BVC24 AI Assistant** — built into your Manufacturing ERP. "
            "I can pull live data from your sales, production, inventory, HR and "
            "approval modules and answer questions about them in plain English."
        ),
    ),
    # Help / capabilities — explicit help asks only, not bare "help" anywhere
    (
        r"^(help|what can you do|what do you do|capabilities|how can you help|how do you work)[\?\s!.,]*$",
        lambda: _conv_reply(
            "help",
            "Here's what I can answer right now:\n\n"
            "• Sales — pending quotations, monthly revenue, pending payments\n"
            "• Projects — which are delayed, production status\n"
            "• Inventory — what's low on stock\n"
            "• HR — who's present today, who's absent, leave requests\n"
            "• Approvals — what's waiting on your sign-off\n"
            "• Headcount — employee + customer overview\n\n"
            "Just type a question or click one of the chips below."
        ),
    ),
    # Goodbye — exact-phrase only (so "see you tomorrow at 5pm" doesn't end the session)
    (
        r"^(bye|goodbye|see ya|cya|talk later|catch you later|good\s*night)[\?\s!.,]*$",
        lambda: _conv_reply(
            "goodbye",
            "Take care! I'm here whenever you need me — just press **Ctrl+K**."
        ),
    ),
    # Apology — short phrases only
    (
        r"^(sorry|my bad|apologies|apologise|apologize)[\s!.,]*$",
        lambda: _conv_reply(
            "apology",
            "No worries at all — ask me anything, however you want to phrase it."
        ),
    ),
    # Simple acknowledgements
    (
        r"^(ok|okay|cool|nice|got it|alright|sure|fine|great|gotcha|understood)[\s!.,]*$",
        lambda: _conv_reply(
            "acknowledgement",
            "👍 Anything else I can pull up for you?"
        ),
    ),
    # Confused — standalone "what?" / "huh?" only, NOT inside "what is X" questions
    (
        r"^(huh|what|wat|whut|come again|say again)[\?\s!.,]*$|^(i don'?t (get|understand)|that'?s wrong|that is wrong|makes no sense)[\?\s!.,]*$",
        lambda: _conv_reply(
            "clarify",
            "Sorry about that — could you rephrase? I work best with questions "
            "about specific data, like *'how many customers do we have'* or "
            "*'show me low stock items'*."
        ),
    ),
]


def conversational_route(query: str):
    """Match small-talk patterns; returns the wrapped response dict or None."""

    q = query.lower().strip()

    for pattern, fn in CONVERSATIONAL_PATTERNS:

        if re.search(pattern, q):

            return fn()

    return None


# ---- Keyword router --------------------------------------------------

INTENT_PATTERNS = [
    # (regex, tool function)
    (r"\b(pending|open|sent)\b.*\bquot",                     tool_pending_quotations),
    (r"\bquot.*\b(pending|status|open)\b",                   tool_pending_quotations),
    (r"\b(delay|delayed|late|overdue|behind)\b.*\bproject",  tool_delayed_projects),
    (r"\bproject.*\b(delay|delayed|late|overdue|behind)\b",  tool_delayed_projects),
    (r"\b(low|out of)\b.*\bstock\b",                         tool_low_stock_inventory),
    (r"\b(stock.*low|stock running)\b",                      tool_low_stock_inventory),
    (r"\binventory.*\b(low|short|out)\b",                    tool_low_stock_inventory),
    (r"\b(absent|missing|not (here|in))\b.*\btoday\b",       tool_absent_today),
    (r"\babsent\b",                                          tool_absent_today),
    (r"\b(who.*\b)?present\b.*\btoday\b",                    tool_present_today),
    (r"\battendance\b.*\btoday\b",                           tool_present_today),
    (r"\b(leave|permission).*\bpending\b",                   tool_pending_leave),
    (r"\bpending\b.*\b(leave|permission)\b",                 tool_pending_leave),
    (r"\b(monthly|month).*\b(revenue|sales|income)\b",       tool_monthly_revenue),
    (r"\brevenue\b",                                         tool_monthly_revenue),
    (r"\bpending\b.*\bpayment\b",                            tool_pending_payments),
    (r"\boutstanding\b.*\bpayment\b",                        tool_pending_payments),
    (r"\bpayment.*\bdue\b",                                  tool_pending_payments),
    (r"\bproduction\b.*\b(status|state)\b",                  tool_production_status),
    (r"\bwork.*order\b",                                     tool_production_status),
    (r"\b(pending|waiting).*\bapproval\b",                   tool_pending_approvals),
    (r"\bapproval.*\b(pending|queue)\b",                     tool_pending_approvals),
    (r"\bemployee.*\b(count|how many|total)\b",              tool_employee_overview),
    (r"\bhow many\b.*\bemployee",                            tool_employee_overview),
    (r"\bcustomer.*\b(count|how many|total)\b",              tool_customer_overview),
    (r"\bhow many\b.*\bcustomer",                            tool_customer_overview),
]


def keyword_route(query: str) -> Optional[callable]:
    """Return the first tool whose regex matches the query, or None."""

    q = query.lower().strip()

    for pattern, fn in INTENT_PATTERNS:

        if re.search(pattern, q):

            return fn

    return None


# ---- Gemini fallback -------------------------------------------------

# Honor GEMINI_MODEL from .env first, then try a sensible fallback chain.
# Ordering rationale: try the user's configured model first; then lite variants
# (cheaper + higher daily quota) before falling back to the heavier flash models.
def _build_model_chain():
    preferred = (os.getenv("GEMINI_MODEL") or "").strip()
    chain = [
        "gemini-2.5-flash-lite",   # 1000 RPD — cheapest, fastest
        "gemini-2.0-flash-lite",   # 1500 RPD — alternative lite
        "gemini-2.5-flash",        # 250 RPD  — preferred quality
        "gemini-2.0-flash",        # 1500 RPD — last resort
    ]
    if preferred and preferred not in chain:
        return [preferred] + chain
    if preferred:
        chain.remove(preferred)
        return [preferred] + chain
    return chain


GEMINI_MODEL_FALLBACKS = _build_model_chain()


# A short menu of available tools the LLM can pick from
TOOL_MENU = """
Available data tools (one of these must answer the user's question):
  pending_quotations  — quotations awaiting send/approval/conversion
  delayed_projects    — projects past their target date and not done
  low_stock_inventory — inventory items running low
  absent_today        — employees with no check-in today
  present_today       — employees who checked in today
  pending_leave       — leave / permission requests pending approval
  monthly_revenue     — this month's sales order revenue
  pending_payments    — outstanding payments on active sales orders
  production_status   — work order breakdown by status
  pending_approvals   — summary count of everything awaiting approval
  employee_overview   — active/total employee counts
  customer_overview   — customer + active SO counts

Reply with EXACTLY one line containing just the tool name, e.g.:
  pending_quotations
"""


TOOL_NAME_TO_FN = {
    "pending_quotations":  tool_pending_quotations,
    "delayed_projects":    tool_delayed_projects,
    "low_stock_inventory": tool_low_stock_inventory,
    "absent_today":        tool_absent_today,
    "present_today":       tool_present_today,
    "pending_leave":       tool_pending_leave,
    "monthly_revenue":     tool_monthly_revenue,
    "pending_payments":    tool_pending_payments,
    "production_status":   tool_production_status,
    "pending_approvals":   tool_pending_approvals,
    "employee_overview":   tool_employee_overview,
    "customer_overview":   tool_customer_overview,
}


def gemini_pick_tool(query: str) -> Optional[str]:
    """Legacy: ask Gemini which tool fits the query. Kept for backwards
    compat — the new resolver below also supports conversational replies."""

    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:

        return None

    try:

        import google.generativeai as genai

        genai.configure(api_key=api_key)

    except Exception:

        return None

    prompt = (
        f"User question: {query!r}\n\n"
        f"{TOOL_MENU}\n"
        "Reply with just the tool name, nothing else."
    )

    for model_name in GEMINI_MODEL_FALLBACKS:

        try:

            model = genai.GenerativeModel(model_name)

            resp = model.generate_content(prompt)

            text = (resp.text or "").strip().lower()

            text = text.split("\n")[0].strip(" `'\"")

            if text in TOOL_NAME_TO_FN:

                return text

        except Exception:

            continue

    return None


def gemini_smart_resolve(query: str) -> Optional[dict]:
    """Upgraded resolver — Gemini picks ONE of:
       1. A data tool to run    → returns { 'kind': 'tool', 'tool': '...' }
       2. A conversational reply → returns { 'kind': 'chat', 'reply': '...' }
       3. None (unavailable / quota)

    The conversational mode lets Gemini answer greetings, follow-ups,
    contextual chat, etc. without forcing a tool dispatch."""

    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:

        log.warning("gemini_smart_resolve: GEMINI_API_KEY missing in .env")

        return None

    try:

        import google.generativeai as genai

        import json as _json

        genai.configure(api_key=api_key)

    except Exception as e:

        log.error(f"gemini_smart_resolve: failed to configure SDK: {e!r}")

        return None

    log.info(f"gemini_smart_resolve: query={query!r}  chain={GEMINI_MODEL_FALLBACKS}")

    tool_list = "\n".join(f"  - {name}" for name in TOOL_NAME_TO_FN.keys())

    prompt = (
        "You are the BVC24 AI Assistant — an in-app assistant for a "
        "Manufacturing ERP that makes vending machines. Be brief, friendly, "
        "and helpful.\n\n"
        f"User said: {query!r}\n\n"
        "You have access to these data tools (use one ONLY if the question "
        "is genuinely asking about live business data):\n"
        f"{tool_list}\n\n"
        "Respond with ONE LINE of JSON, no markdown, no code fences:\n"
        '  { "kind": "tool", "tool": "<tool_name>" }   — to fetch data\n'
        '  { "kind": "chat", "reply": "<your answer>" } — to chat / explain\n\n'
        "Examples:\n"
        '  user: "what is my cash situation"      → { "kind":"tool","tool":"pending_payments" }\n'
        '  user: "hello"                           → { "kind":"chat","reply":"Hi! How can I help?" }\n'
        '  user: "what does an ERP do"             → { "kind":"chat","reply":"An ERP unifies..." }\n'
        '  user: "thanks"                          → { "kind":"chat","reply":"You\'re welcome!" }\n'
    )

    for model_name in GEMINI_MODEL_FALLBACKS:

        try:

            model = genai.GenerativeModel(model_name)

            resp = model.generate_content(prompt)

            raw = (resp.text or "").strip()

            log.info(f"gemini_smart_resolve: {model_name} replied: {raw[:120]!r}")

            # Strip any accidental markdown fences
            if raw.startswith("```"):

                raw = raw.strip("`")

                if raw.lower().startswith("json"):

                    raw = raw[4:].strip()

            # First brace-balanced JSON object on the line
            try:

                parsed = _json.loads(raw)

            except Exception:

                # Sometimes the model returns extra prose — try to find a JSON object
                start = raw.find("{")

                end   = raw.rfind("}")

                if start != -1 and end > start:

                    try:

                        parsed = _json.loads(raw[start:end + 1])

                    except Exception:

                        continue

                else:

                    continue

            kind = parsed.get("kind")

            if kind == "tool":

                name = (parsed.get("tool") or "").strip().lower()

                if name in TOOL_NAME_TO_FN:

                    return {"kind": "tool", "tool": name}

            elif kind == "chat":

                reply = (parsed.get("reply") or "").strip()

                if reply:

                    return {"kind": "chat", "reply": reply}

        except Exception as e:

            log.warning(f"gemini_smart_resolve: {model_name} FAILED → {str(e)[:120]}")

            continue

    log.warning("gemini_smart_resolve: all models exhausted — returning None")

    return None


# ---- Main entry ------------------------------------------------------

def answer_query(db: Session, query: str) -> dict:
    """Route a natural-language admin question to the right resolver.

    Resolution order:
      1. Keyword router          — fast, free, deterministic data tools
      2. Conversational matcher  — greetings, thanks, help, who-are-you
      3. Gemini smart resolver   — picks tool OR generates chat reply
      4. Friendly fallback       — when even Gemini can't decide
    """

    if not query or not query.strip():

        return {
            "intent": "empty",
            "matched_via": "none",
            "answer": "Please type a question — e.g. 'show pending quotations'.",
            "data": None,
            "suggestions": DATA_SUGGESTIONS,
        }

    log.info(f"answer_query: incoming query={query!r}")

    # 1. Keyword router → data tool match (always wins, fastest path)
    fn = keyword_route(query)

    if fn is not None:

        log.info(f"answer_query: matched via KEYWORD → {fn.__name__}")

        result = fn(db)

        result["matched_via"] = "keyword"

        result["query"] = query

        return result

    # 2. Conversational matcher → friendly small-talk reply
    conv = conversational_route(query)

    if conv is not None:

        log.info(f"answer_query: matched via CONVERSATION → {conv.get('intent')}")

        conv["query"] = query

        return conv

    # 3. Gemini smart resolver → either runs a tool OR replies in chat
    log.info("answer_query: no local match — escalating to Gemini")

    gem = gemini_smart_resolve(query)

    if gem is not None:

        if gem["kind"] == "tool":

            name = gem["tool"]

            if name in TOOL_NAME_TO_FN:

                log.info(f"answer_query: matched via GEMINI tool → {name}")

                result = TOOL_NAME_TO_FN[name](db)

                result["matched_via"] = "gemini"

                result["query"] = query

                return result

        elif gem["kind"] == "chat":

            log.info(f"answer_query: matched via GEMINI chat → {gem['reply'][:60]!r}")

            return {
                "intent": "chat",
                "matched_via": "gemini",
                "answer": gem["reply"],
                "data": None,
                "suggestions": DATA_SUGGESTIONS[:4],
                "query": query,
            }

    log.warning(f"answer_query: returning fallback for {query!r}")

    # 4. Friendly fallback — Gemini unreachable / undecided
    return {
        "intent": "unknown",
        "matched_via": "none",
        "answer": (
            "I didn't catch that one — could you rephrase or pick a chip below? "
            "I'm best at questions about live business data like sales, "
            "production, inventory, attendance, payments and approvals."
        ),
        "data": None,
        "suggestions": DATA_SUGGESTIONS,
        "query": query,
    }
