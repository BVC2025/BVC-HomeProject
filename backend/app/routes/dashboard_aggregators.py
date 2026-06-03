"""Mission Control dashboard aggregators (Phase 2).

Four small endpoints that feed the new dashboard panels:

  GET /admin/dashboard/sparklines       7-day series per KPI
  GET /admin/dashboard/health-score     5 sub-scores + overall + label
  GET /admin/dashboard/factory-status   machines/WO/efficiency
  GET /admin/dashboard/production-flow  pipeline counts + conversion %
"""

from datetime import date, datetime, timedelta
from typing import Dict, List

from fastapi import APIRouter, Depends
from sqlalchemy import func, cast, Date, extract
from sqlalchemy.orm import Session

from app.database.database import get_db

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
    WorkOrderStageProgress,
    Notification,
    Employee,
    ProcessStage,
)


router = APIRouter(prefix="/admin/dashboard", tags=["Dashboard Aggregators"])


# =====================================================================
# 1. SPARKLINES — 7-day series per KPI
# =====================================================================

def _series_by_date(rows: list, days: int = 7) -> List[int]:
    """Convert [(date, count), ...] from a GROUP BY query into a
    dense 7-element list, filling missing days with 0."""

    today = date.today()

    out = []

    by_date = {r[0]: int(r[1] or 0) for r in rows}

    for i in range(days - 1, -1, -1):

        d = today - timedelta(days=i)

        out.append(by_date.get(d, 0))

    return out


def _count_per_day(db: Session, model, date_col, days: int = 7,
                   extra_filter=None) -> List[int]:

    cutoff = date.today() - timedelta(days=days - 1)

    q = db.query(
        cast(date_col, Date).label("d"),
        func.count(model.ID),
    ).filter(cast(date_col, Date) >= cutoff)

    if extra_filter is not None:

        q = q.filter(extra_filter)

    rows = q.group_by("d").all()

    return _series_by_date(rows, days)


def _sum_per_day(db: Session, model, date_col, sum_col, days: int = 7,
                 extra_filter=None) -> List[float]:

    cutoff = date.today() - timedelta(days=days - 1)

    q = db.query(
        cast(date_col, Date).label("d"),
        func.coalesce(func.sum(sum_col), 0.0).label("s"),
    ).filter(cast(date_col, Date) >= cutoff)

    if extra_filter is not None:

        q = q.filter(extra_filter)

    rows = q.group_by("d").all()

    today = date.today()

    by_date = {r[0]: float(r[1] or 0.0) for r in rows}

    return [
        round(by_date.get(today - timedelta(days=i), 0.0), 2)
        for i in range(days - 1, -1, -1)
    ]


@router.get("/sparklines")
def sparklines(db: Session = Depends(get_db)):
    """Returns a 7-element array for each KPI tile.

    Each item is the daily aggregate for the last 7 days
    (index 0 = 6 days ago, index 6 = today)."""

    return {
        "monthly_revenue":         _sum_per_day(
            db, SalesOrder, SalesOrder.SO_DATE, SalesOrder.GRAND_TOTAL,
            extra_filter=(SalesOrder.STATUS != "CANCELLED")
        ),
        "total_sales_orders":      _count_per_day(
            db, SalesOrder, SalesOrder.SO_DATE,
            extra_filter=(SalesOrder.STATUS != "CANCELLED")
        ),
        "total_quotations":        _count_per_day(db, Quotation, Quotation.CREATED_AT),
        "total_customers":         _count_per_day(db, Customer, Customer.CREATED_AT)
            if hasattr(Customer, "CREATED_AT") else [0]*7,
        "active_projects":         _count_per_day(db, Project, Project.CREATED_AT)
            if hasattr(Project, "CREATED_AT") else [0]*7,
        "production_active":       _count_per_day(db, WorkOrder, WorkOrder.CREATED_AT)
            if hasattr(WorkOrder, "CREATED_AT") else [0]*7,
        "inventory_value":         [0]*7,  # snapshot quantity, no time series
        "purchase_orders":         _count_per_day(db, PurchaseOrder, PurchaseOrder.CREATED_AT)
            if hasattr(PurchaseOrder, "CREATED_AT") else [0]*7,
        "pending_payments":        [0]*7,  # snapshot
        "employees_present_today": _count_per_day(
            db, Attendance, Attendance.DATE,
            extra_filter=(Attendance.STATUS.in_(["PRESENT", "LATE"]))
        ),
        "leave_requests_pending":  _count_per_day(db, LeaveRequest, LeaveRequest.CREATED_AT),
        "ai_notifications":        _count_per_day(db, Notification, Notification.CREATED_AT),
    }


# =====================================================================
# 2. HEALTH SCORE — 5 sub-scores + overall
# =====================================================================

def _score_sales(db: Session) -> tuple:
    """Compare this month's revenue vs last month. Higher = better."""

    now = datetime.now()

    this_month_first = date(now.year, now.month, 1)

    last_month_first = (
        date(now.year - 1, 12, 1) if now.month == 1
        else date(now.year, now.month - 1, 1)
    )

    this_rev = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0)
    ).filter(
        SalesOrder.SO_DATE >= this_month_first,
        SalesOrder.STATUS != "CANCELLED"
    ).scalar() or 0.0

    last_rev = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0)
    ).filter(
        SalesOrder.SO_DATE >= last_month_first,
        SalesOrder.SO_DATE < this_month_first,
        SalesOrder.STATUS != "CANCELLED"
    ).scalar() or 0.0

    # Base 60 + up to 40 for >=20% growth
    if last_rev <= 0:

        score = 70 if this_rev > 0 else 50

        note = (
            "First-month sales recorded." if this_rev > 0
            else "No revenue this month yet."
        )

    else:

        delta = (this_rev - last_rev) / last_rev

        score = int(round(max(0, min(100, 70 + delta * 100))))

        if delta >= 0.10:

            note = f"Revenue up {delta*100:.0f}% vs last month."

        elif delta >= 0:

            note = f"Revenue flat-to-up ({delta*100:.0f}%)."

        else:

            note = f"Revenue down {abs(delta)*100:.0f}% vs last month."

    return score, note


def _score_production(db: Session) -> tuple:
    """On-schedule projects out of total active."""

    today = date.today()

    active = db.query(func.count(Project.ID)).filter(
        ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"])
    ).scalar() or 0

    delayed = db.query(func.count(Project.ID)).filter(
        ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"]),
        Project.TARGET_DATE.isnot(None),
        Project.TARGET_DATE < today,
    ).scalar() or 0

    if active == 0:

        return 75, "No active projects in flight."

    on_schedule = active - delayed

    pct = on_schedule / active

    score = int(round(pct * 100))

    if delayed == 0:

        note = "Every active project is on schedule."

    elif delayed == 1:

        note = "1 project past target date."

    else:

        note = f"{delayed} projects past target date."

    return score, note


def _score_inventory(db: Session, threshold: int = 10) -> tuple:
    """Fraction of inventory items above the low-stock threshold."""

    total = db.query(func.count(Inventory.ID)).scalar() or 0

    low = db.query(func.count(Inventory.ID)).filter(
        Inventory.QUANTITY < threshold
    ).scalar() or 0

    if total == 0:

        return 50, "No inventory items on file."

    healthy = total - low

    pct = healthy / total

    score = int(round(pct * 100))

    if low == 0:

        note = f"All {total} items above the {threshold}-unit threshold."

    else:

        note = f"{low} of {total} items below the {threshold}-unit threshold."

    return score, note


def _score_hr(db: Session) -> tuple:
    """Today's attendance ratio."""

    today = date.today()

    active = db.query(func.count(Employee.ID)).filter(
        Employee.STATUS == "ACTIVE"
    ).scalar() or 0

    present = db.query(func.count(Attendance.ID)).filter(
        Attendance.DATE == today,
        Attendance.STATUS.in_(["PRESENT", "LATE", "HALF_DAY"])
    ).scalar() or 0

    if active == 0:

        return 50, "No active employees on file."

    pct = present / active

    score = int(round(pct * 100))

    if pct >= 0.95:

        note = f"{present}/{active} present — almost full strength."

    elif pct >= 0.80:

        note = f"{present}/{active} present — normal headcount."

    else:

        note = f"Only {present}/{active} present — check attendance."

    return score, note


def _score_finance(db: Session) -> tuple:
    """Ratio of paid vs outstanding on active sales orders."""

    row = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0),
        func.coalesce(func.sum(SalesOrder.ADVANCE_RECEIVED), 0.0),
    ).filter(
        SalesOrder.STATUS.in_([
            "AWAITING_ADVANCE", "CONFIRMED", "IN_PRODUCTION",
            "SHIPPED", "DELIVERED"
        ])
    ).first()

    gross = float(row[0] or 0)
    paid  = float(row[1] or 0)

    if gross <= 0:

        return 75, "No active sales orders pending payment."

    pct = paid / gross

    score = int(round(pct * 100))

    pending = gross - paid

    note = (
        f"{score}% collected — ₹{pending/100000:.1f}L outstanding."
    )

    return score, note


def _label_for_score(s: int) -> str:

    if s >= 90:  return "Excellent Performance"

    if s >= 75:  return "Strong Performance"

    if s >= 60:  return "Steady Performance"

    if s >= 40:  return "Needs Attention"

    return "Critical — Action Required"


@router.get("/health-score")
def health_score(db: Session = Depends(get_db)):
    """Composite business-health score (0-100)."""

    sales,      sales_note      = _score_sales(db)
    production, production_note = _score_production(db)
    inventory,  inventory_note  = _score_inventory(db)
    hr,         hr_note         = _score_hr(db)
    finance,    finance_note    = _score_finance(db)

    # Weighted average — slightly skewed towards revenue + production
    weights = {
        "sales":      0.25,
        "production": 0.22,
        "finance":    0.20,
        "inventory":  0.18,
        "hr":         0.15,
    }

    overall = int(round(
        sales * weights["sales"] +
        production * weights["production"] +
        inventory * weights["inventory"] +
        hr * weights["hr"] +
        finance * weights["finance"]
    ))

    # Surface the top 2 weakest dimensions as "actions" to focus on
    breakdown = [
        ("Sales",      sales,      sales_note),
        ("Production", production, production_note),
        ("Inventory",  inventory,  inventory_note),
        ("HR",         hr,         hr_note),
        ("Finance",    finance,    finance_note),
    ]

    weak = sorted(breakdown, key=lambda x: x[1])[:2]

    actions = [
        {"area": name, "score": score, "note": note}
        for name, score, note in weak
    ]

    return {
        "overall": overall,
        "label": _label_for_score(overall),
        "scores": {
            "sales":      {"value": sales,      "note": sales_note},
            "production": {"value": production, "note": production_note},
            "inventory":  {"value": inventory,  "note": inventory_note},
            "hr":         {"value": hr,         "note": hr_note},
            "finance":    {"value": finance,    "note": finance_note},
        },
        "weights": weights,
        "actions": actions,
        "as_of": datetime.now().isoformat(),
    }


# =====================================================================
# 3. FACTORY STATUS
# =====================================================================

@router.get("/factory-status")
def factory_status(db: Session = Depends(get_db)):
    """Live shop-floor snapshot.

    Maps WorkOrder statuses to factory states:
      IN_PROGRESS  → running
      PLANNED      → idle (waiting to start)
      ON_HOLD      → maintenance equivalent
    """

    by_status_rows = db.query(
        WorkOrder.STATUS, func.count(WorkOrder.ID)
    ).group_by(WorkOrder.STATUS).all()

    by_status = {s: int(c or 0) for s, c in by_status_rows}

    running     = by_status.get("IN_PROGRESS", 0)
    idle        = by_status.get("PLANNED",     0)
    maintenance = by_status.get("ON_HOLD",     0)
    done        = by_status.get("DONE",        0)
    cancelled   = by_status.get("CANCELLED",   0)

    # Active projects
    active_projects = db.query(func.count(Project.ID)).filter(
        ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"])
    ).scalar() or 0

    today = date.today()

    delayed_projects = db.query(func.count(Project.ID)).filter(
        ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"]),
        Project.TARGET_DATE.isnot(None),
        Project.TARGET_DATE < today,
    ).scalar() or 0

    completed_projects = db.query(func.count(Project.ID)).filter(
        Project.STATUS.in_(["COMPLETED", "CLOSED"])
    ).scalar() or 0

    # Efficiency — completed stages / total stages across IN_PROGRESS WOs
    active_wo_ids = [
        r[0] for r in db.query(WorkOrder.ID).filter(
            WorkOrder.STATUS == "IN_PROGRESS"
        ).all()
    ]

    if active_wo_ids:

        total_stages = db.query(func.count(WorkOrderStageProgress.ID)).filter(
            WorkOrderStageProgress.WORK_ORDER_ID.in_(active_wo_ids)
        ).scalar() or 0

        done_stages = db.query(func.count(WorkOrderStageProgress.ID)).filter(
            WorkOrderStageProgress.WORK_ORDER_ID.in_(active_wo_ids),
            WorkOrderStageProgress.STATUS == "DONE"
        ).scalar() or 0

        efficiency = int(round(
            (done_stages / max(1, total_stages)) * 100
        ))

    else:

        efficiency = 100 if (running + idle == 0) else 0

    return {
        "machines": {
            "running":     running,
            "idle":        idle,
            "maintenance": maintenance,
        },
        "work_orders": {
            "active":   running + idle,
            "running":  running,
            "idle":     idle,
            "on_hold":  maintenance,
            "done":     done,
            "cancelled": cancelled,
        },
        "projects": {
            "active":    active_projects,
            "delayed":   delayed_projects,
            "completed": completed_projects,
        },
        "efficiency_pct": efficiency,
        "as_of": datetime.now().isoformat(),
    }


# =====================================================================
# 4. PRODUCTION FLOW — pipeline counts + conversion %
# =====================================================================

# =====================================================================
# 5. AI INSIGHT ENGINE — rule-based generator
# =====================================================================
# Scans live data and produces 3-5 actionable insight cards. Each card:
#   { severity, icon, title, body, suggestion, action_url }
# Severity: critical | warning | info | success
# Deterministic + fast; no LLM dependency. Gemini polish optional.

@router.get("/insights")
def insights(db: Session = Depends(get_db)):

    cards = []

    today = date.today()

    now = datetime.now()

    # --- 1. Low stock check -----------------------------------------
    low = db.query(func.count(Inventory.ID)).filter(
        Inventory.QUANTITY < 10
    ).scalar() or 0

    if low > 0:

        worst = db.query(Inventory).filter(
            Inventory.QUANTITY < 10
        ).order_by(Inventory.QUANTITY.asc()).first()

        severity = "critical" if low >= 20 else "warning"

        cards.append({
            "severity": severity,
            "icon": "📦",
            "title": f"{low} item(s) running low on stock",
            "body": (
                f"Lowest: {worst.MATERIAL_NAME} ({int(worst.QUANTITY or 0)} units)"
                if worst else "Multiple SKUs below threshold."
            ),
            "suggestion": (
                f"Raise a Purchase Order for the {min(low, 5)} most depleted items."
            ),
            "action_url": "/inventory",
            "action_label": "Open Inventory",
        })

    # --- 2. Revenue trend -------------------------------------------
    this_month_first = date(now.year, now.month, 1)

    last_month_first = (
        date(now.year - 1, 12, 1) if now.month == 1
        else date(now.year, now.month - 1, 1)
    )

    this_rev = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0)
    ).filter(
        SalesOrder.SO_DATE >= this_month_first,
        SalesOrder.STATUS != "CANCELLED",
    ).scalar() or 0.0

    last_rev = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0)
    ).filter(
        SalesOrder.SO_DATE >= last_month_first,
        SalesOrder.SO_DATE < this_month_first,
        SalesOrder.STATUS != "CANCELLED",
    ).scalar() or 0.0

    if last_rev > 0:

        delta = (this_rev - last_rev) / last_rev

        if delta >= 0.10:

            cards.append({
                "severity": "success",
                "icon": "📈",
                "title": f"Revenue up {delta*100:.0f}% month-over-month",
                "body": (
                    f"This month ₹{this_rev/100000:.1f}L vs "
                    f"₹{last_rev/100000:.1f}L last month."
                ),
                "suggestion": (
                    "Lock the trend — review which customers / products drove the lift."
                ),
                "action_url": "/sales-orders",
                "action_label": "View Sales Orders",
            })

        elif delta <= -0.10:

            cards.append({
                "severity": "warning",
                "icon": "📉",
                "title": f"Revenue down {abs(delta)*100:.0f}% vs last month",
                "body": (
                    f"This month ₹{this_rev/100000:.1f}L vs "
                    f"₹{last_rev/100000:.1f}L last month."
                ),
                "suggestion": (
                    "Check open quotations and follow up with prospects."
                ),
                "action_url": "/quotations",
                "action_label": "Review Quotations",
            })

    # --- 3. Delayed projects ----------------------------------------
    delayed_rows = db.query(Project).filter(
        ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"]),
        Project.TARGET_DATE.isnot(None),
        Project.TARGET_DATE < today,
    ).order_by(Project.TARGET_DATE.asc()).limit(3).all()

    if delayed_rows:

        worst = delayed_rows[0]

        days_late = (today - worst.TARGET_DATE).days

        cards.append({
            "severity": "critical" if days_late > 7 else "warning",
            "icon": "⚠️",
            "title": (
                f"{len(delayed_rows)} project(s) past target"
                + (f" — {worst.PROJECT_NAME} {days_late}d late" if worst.PROJECT_NAME else "")
            ),
            "body": (
                ", ".join(p.PROJECT_NAME or f"#{p.ID}" for p in delayed_rows[:3])
            ),
            "suggestion": (
                "Reassign capacity or extend the target date with customer sign-off."
            ),
            "action_url": "/projects",
            "action_label": "Open Projects",
        })

    # --- 4. Outstanding customer payments ---------------------------
    row = db.query(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0),
        func.coalesce(func.sum(SalesOrder.ADVANCE_RECEIVED), 0.0),
        func.count(SalesOrder.ID),
    ).filter(
        SalesOrder.STATUS.in_([
            "AWAITING_ADVANCE", "CONFIRMED",
            "IN_PRODUCTION", "SHIPPED", "DELIVERED",
        ])
    ).first()

    gross = float(row[0] or 0)
    paid  = float(row[1] or 0)
    so_count = int(row[2] or 0)

    outstanding = max(0.0, gross - paid)

    if outstanding > 100000 and so_count > 0:

        cards.append({
            "severity": "warning" if outstanding < 500000 else "critical",
            "icon": "💰",
            "title": f"₹{outstanding/100000:.1f}L outstanding from customers",
            "body": (
                f"Across {so_count} active sales order(s). "
                f"Collected so far: ₹{paid/100000:.1f}L."
            ),
            "suggestion": (
                "Trigger payment reminders for the overdue advance / final amounts."
            ),
            "action_url": "/sales-orders",
            "action_label": "Open Sales Orders",
        })

    # --- 5. Attendance drop ----------------------------------------
    active = db.query(func.count(Employee.ID)).filter(
        Employee.STATUS == "ACTIVE"
    ).scalar() or 0

    present = db.query(func.count(Attendance.ID)).filter(
        Attendance.DATE == today,
        Attendance.STATUS.in_(["PRESENT", "LATE", "HALF_DAY"]),
    ).scalar() or 0

    if active > 0:

        pct = present / active

        if pct < 0.70:

            cards.append({
                "severity": "warning" if pct >= 0.50 else "critical",
                "icon": "👥",
                "title": (
                    f"Only {present}/{active} employees present today "
                    f"({pct*100:.0f}%)"
                ),
                "body": (
                    f"{active - present} not yet checked in. "
                    "Check approved leaves vs absentees."
                ),
                "suggestion": "Open Attendance to see who hasn't shown up.",
                "action_url": "/attendance",
                "action_label": "Open Attendance",
            })

    # --- 6. Pending approvals piling up -----------------------------
    pending_leaves = db.query(func.count(LeaveRequest.ID)).filter(
        LeaveRequest.STATUS == "PENDING_APPROVAL"
    ).scalar() or 0

    pending_quotes = db.query(func.count(Quotation.ID)).filter(
        Quotation.STATUS.in_(["SENT", "NEGOTIATION"])
    ).scalar() or 0

    pending_pos = db.query(func.count(PurchaseOrder.ID)).filter(
        PurchaseOrder.STATUS == "DRAFT"
    ).scalar() or 0

    pending_total = pending_leaves + pending_quotes + pending_pos

    if pending_total >= 5:

        cards.append({
            "severity": "info",
            "icon": "✅",
            "title": f"{pending_total} item(s) waiting for your approval",
            "body": (
                f"{pending_leaves} leave / permission · "
                f"{pending_quotes} quotation · "
                f"{pending_pos} purchase order"
            ),
            "suggestion": "Process them in one batch from the Approval Center.",
            "action_url": "/approvals",
            "action_label": "Open Approval Center",
        })

    # --- 7. Pipeline gap — drafts not progressing -------------------
    draft_quotes = db.query(func.count(Quotation.ID)).filter(
        Quotation.STATUS == "DRAFT"
    ).scalar() or 0

    if draft_quotes >= 3:

        cards.append({
            "severity": "info",
            "icon": "📝",
            "title": f"{draft_quotes} quotation(s) still in draft",
            "body": "These haven't been sent to customers yet.",
            "suggestion": "Review drafts and send the qualified ones today.",
            "action_url": "/quotations",
            "action_label": "Open Quotations",
        })

    # If nothing flagged, surface a positive
    if not cards:

        cards.append({
            "severity": "success",
            "icon": "✨",
            "title": "Everything is on track",
            "body": (
                "No critical alerts in inventory, projects, attendance, "
                "payments, or approvals."
            ),
            "suggestion": "A good moment to look ahead — review the analytics tab.",
            "action_url": "/",
            "action_label": "Continue",
        })

    # Sort: critical → warning → info → success
    severity_rank = {"critical": 0, "warning": 1, "info": 2, "success": 3}

    cards.sort(key=lambda c: severity_rank.get(c["severity"], 9))

    return {
        "as_of": now.isoformat(),
        "count": len(cards),
        "insights": cards[:6],   # cap at 6 to keep the panel tidy
    }


# =====================================================================
# 6. ACTIVITY FEED — cross-module recent inserts
# =====================================================================

@router.get("/activity-feed")
def activity_feed(
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """Union over recent rows across multiple tables. Each entry has
    a uniform shape so the UI renders them with one component."""

    items = []

    # Recent sales orders
    for r in db.query(SalesOrder).order_by(SalesOrder.ID.desc()).limit(8).all():

        items.append({
            "ts": (r.CREATED_AT or datetime.now()).isoformat()
                  if hasattr(r, "CREATED_AT") else datetime.now().isoformat(),
            "kind": "sales_order",
            "icon": "🛒",
            "color": "ok",
            "text": f"Sales Order {r.SO_NUMBER or f'#{r.ID}'} created",
            "subtext": f"{r.STATUS} · ₹{float(r.GRAND_TOTAL or 0):,.0f}",
            "href": "/sales-orders",
        })

    # Recent quotations
    for r in db.query(Quotation).order_by(Quotation.ID.desc()).limit(8).all():

        items.append({
            "ts": (r.CREATED_AT or datetime.now()).isoformat(),
            "kind": "quotation",
            "icon": "📋",
            "color": "info",
            "text": f"Quotation {r.QUOTATION_NUMBER or f'#{r.ID}'}",
            "subtext": f"{r.STATUS} · ₹{float(r.GRAND_TOTAL or 0):,.0f}",
            "href": "/quotations",
        })

    # Recent customers
    for r in db.query(Customer).order_by(Customer.ID.desc()).limit(5).all():

        ts = getattr(r, "CREATED_AT", None) or getattr(r, "LEAD_CREATED_DATE", None)
        items.append({
            "ts": ts.isoformat() if ts else datetime.now().isoformat(),
            "kind": "customer",
            "icon": "👤",
            "color": "purple",
            "text": f"Customer {r.CUSTOMER_NAME or f'#{r.ID}'} added",
            "subtext": (r.CUSTOMER_TYPE or "Customer"),
            "href": "/customers",
        })

    # Recent leave events
    for r in db.query(LeaveRequest).order_by(LeaveRequest.ID.desc()).limit(8).all():

        emp = (
            db.query(Employee).filter(Employee.ID == r.EMPLOYEE_ID).first()
            if r.EMPLOYEE_ID else None
        )

        verb = {
            "PENDING_APPROVAL": "applied",
            "APPROVED":          "approved",
            "REJECTED":          "rejected",
            "CANCELLED":         "cancelled",
        }.get(r.STATUS, "submitted")

        items.append({
            "ts": (r.CREATED_AT or datetime.now()).isoformat(),
            "kind": "leave",
            "icon": "🏖" if r.LEAVE_TYPE != "PERMISSION" else "⏱",
            "color": "warn" if r.STATUS == "PENDING_APPROVAL" else "ok",
            "text": (
                f"{(emp.NAME if emp else 'Employee')} {verb} "
                f"{r.LEAVE_TYPE.lower() if r.LEAVE_TYPE else 'leave'}"
            ),
            "subtext": (
                f"{r.START_DATE.isoformat() if r.START_DATE else '?'}"
                + (f" → {r.END_DATE.isoformat()}" if r.END_DATE and r.END_DATE != r.START_DATE else "")
            ),
            "href": "/approvals",
        })

    # Recent purchase orders
    for r in db.query(PurchaseOrder).order_by(PurchaseOrder.ID.desc()).limit(5).all():

        items.append({
            "ts": (r.CREATED_AT or datetime.now()).isoformat(),
            "kind": "purchase_order",
            "icon": "📦",
            "color": "info",
            "text": f"Purchase Order {r.PO_NUMBER or f'#{r.ID}'} {r.STATUS.lower() if r.STATUS else 'created'}",
            "subtext": f"₹{float(r.GRAND_TOTAL or 0):,.0f}",
            "href": "/purchase-orders",
        })

    # Recent attendance (today only — newest check-ins)
    today = date.today()

    for r in db.query(Attendance, Employee).join(
        Employee, Attendance.EMPLOYEE_ID == Employee.ID
    ).filter(
        Attendance.DATE == today,
        Attendance.CHECK_IN.isnot(None),
    ).order_by(Attendance.CHECK_IN.desc()).limit(6).all():

        att, emp = r

        items.append({
            "ts": att.CHECK_IN.isoformat() if att.CHECK_IN else datetime.now().isoformat(),
            "kind": "attendance",
            "icon": "🟢" if att.STATUS == "PRESENT" else "🟡",
            "color": "ok" if att.STATUS == "PRESENT" else "warn",
            "text": f"{emp.NAME} checked in",
            "subtext": (
                f"{att.STATUS} · "
                f"{att.CHECK_IN.strftime('%H:%M') if att.CHECK_IN else '?'}"
            ),
            "href": "/attendance",
        })

    # Recent work orders
    if hasattr(WorkOrder, "CREATED_AT"):

        for r in db.query(WorkOrder).order_by(WorkOrder.ID.desc()).limit(4).all():

            items.append({
                "ts": (r.CREATED_AT or datetime.now()).isoformat(),
                "kind": "work_order",
                "icon": "🏭",
                "color": "primary",
                "text": f"Work Order {r.WO_NUMBER or f'#{r.ID}'} · {r.STATUS}",
                "subtext": (f"{r.QUANTITY} units" if r.QUANTITY else ""),
                "href": "/production",
            })

    # Sort by ts desc, cap to `limit`
    items.sort(key=lambda x: x["ts"], reverse=True)

    return {
        "as_of": datetime.now().isoformat(),
        "count": len(items),
        "items": items[:limit],
    }


@router.get("/production-flow")
def production_flow(db: Session = Depends(get_db)):
    """Returns a 7-stage pipeline. Each stage:
      label, count, conversion_pct (to the next stage)

    Pipeline: Quotation → Sales Order → Project → Production → QC
              → Dispatch → Completed
    """

    # Stage counts
    quote_open = db.query(func.count(Quotation.ID)).filter(
        Quotation.STATUS.in_(["DRAFT", "SENT", "NEGOTIATION", "APPROVED"])
    ).scalar() or 0

    so_active = db.query(func.count(SalesOrder.ID)).filter(
        SalesOrder.STATUS.in_(["DRAFT", "AWAITING_ADVANCE", "CONFIRMED"])
    ).scalar() or 0

    project_active = db.query(func.count(Project.ID)).filter(
        ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"])
    ).scalar() or 0

    production_active = db.query(func.count(WorkOrder.ID)).filter(
        WorkOrder.STATUS.in_(["PLANNED", "IN_PROGRESS"])
    ).scalar() or 0

    # QC — WO stages with type=QC currently in progress
    qc_active = db.query(
        func.count(WorkOrderStageProgress.ID)
    ).join(
        ProcessStage, WorkOrderStageProgress.STAGE_ID == ProcessStage.ID
    ).filter(
        WorkOrderStageProgress.STATUS == "IN_PROGRESS",
        ProcessStage.STAGE_TYPE == "QC",
    ).scalar() or 0

    dispatch = db.query(func.count(SalesOrder.ID)).filter(
        SalesOrder.STATUS == "SHIPPED"
    ).scalar() or 0

    completed = db.query(func.count(SalesOrder.ID)).filter(
        SalesOrder.STATUS.in_(["DELIVERED", "CLOSED"])
    ).scalar() or 0

    stages = [
        {"label": "Quotation",    "count": quote_open,        "icon": "📋"},
        {"label": "Sales Order",  "count": so_active,         "icon": "🛒"},
        {"label": "Project",      "count": project_active,    "icon": "🏗️"},
        {"label": "Production",   "count": production_active, "icon": "🏭"},
        {"label": "QC",           "count": qc_active,         "icon": "🔬"},
        {"label": "Dispatch",     "count": dispatch,          "icon": "🚚"},
        {"label": "Completed",    "count": completed,         "icon": "✅"},
    ]

    # Conversion % — fraction of next-stage count vs current.
    # Capped at 100% (a stage CAN have a higher count than its predecessor
    # when items take time to move through, e.g. lots of older completed
    # vs few current quotations).
    for i, s in enumerate(stages):

        if i == len(stages) - 1:

            s["conversion_pct"] = None  # last stage, no "next"

            continue

        cur = s["count"]

        nxt = stages[i + 1]["count"]

        if cur <= 0:

            s["conversion_pct"] = None

        else:

            s["conversion_pct"] = min(100, int(round((nxt / cur) * 100)))

    return {
        "stages": stages,
        "total_in_pipeline": sum(s["count"] for s in stages[:-1]),
        "completed_total": completed,
        "as_of": datetime.now().isoformat(),
    }


# =====================================================================
# 7. TOP PERFORMERS — 5 spotlight categories
# =====================================================================
# Sources:
#   1. Employee of the Month  → PerformanceScore.OVERALL_STARS (latest)
#   2. Best Attendance        → count of PRESENT/LATE this month
#   3. Best Sales Executive   → count of SalesOrder.PREPARED_BY this month
#   4. Best Production Engineer → count of WO stages DONE (ASSIGNED_TO_ID)
#   5. Best Team              → average score by department

@router.get("/top-performers")
def top_performers(db: Session = Depends(get_db)):

    from app.models.models import PerformanceScore, Department, Designation

    now = datetime.now()

    this_month_first = date(now.year, now.month, 1)

    def _serialize_emp(emp: Employee, score: float, label: str) -> dict:

        designation = None

        if emp and emp.DESIGNATION_ID:

            d = db.query(Designation).filter(
                Designation.ID == emp.DESIGNATION_ID
            ).first()

            designation = d.TITLE if d else None

        return {
            "id":           emp.ID if emp else None,
            "name":         emp.NAME if emp else "—",
            "code":         emp.EMPLOYEE_CODE if emp else None,
            "designation":  designation,
            "photo_url":    emp.PHOTO_URL if emp else None,
            "score":        round(float(score or 0), 1),
            "score_label":  label,
            "initial":      (emp.NAME[0] if emp and emp.NAME else "?").upper(),
        }

    # --- 1. Employee of the Month — highest OVERALL_STARS, latest period
    eom_row = db.query(PerformanceScore, Employee).join(
        Employee, PerformanceScore.EMPLOYEE_ID == Employee.ID
    ).filter(
        Employee.STATUS == "ACTIVE",
    ).order_by(
        PerformanceScore.PAY_YEAR.desc(),
        PerformanceScore.PAY_MONTH.desc(),
        PerformanceScore.OVERALL_STARS.desc(),
    ).first()

    eom = None

    if eom_row:

        ps, emp = eom_row

        eom = {
            **_serialize_emp(emp, ps.OVERALL_STARS or 0, f"{ps.OVERALL_STARS or 0:.1f}/5.0 stars"),
            "badge": "🏆 Employee of the Month",
            "badge_color": "primary",
            "subtitle": f"Period: {ps.PAY_YEAR}-{ps.PAY_MONTH:02d}",
        }

    # --- 2. Best Attendance — most check-ins this month
    att_row = db.query(
        Attendance.EMPLOYEE_ID,
        func.count(Attendance.ID).label("c"),
    ).filter(
        Attendance.DATE >= this_month_first,
        Attendance.STATUS.in_(["PRESENT", "LATE", "HALF_DAY"]),
    ).group_by(Attendance.EMPLOYEE_ID).order_by(
        func.count(Attendance.ID).desc()
    ).first()

    best_attendance = None

    if att_row:

        emp = db.query(Employee).filter(Employee.ID == att_row[0]).first()

        if emp:

            best_attendance = {
                **_serialize_emp(emp, att_row[1], f"{att_row[1]} days present"),
                "badge": "🟢 Best Attendance",
                "badge_color": "ok",
                "subtitle": f"{att_row[1]} day(s) this month",
            }

    # --- 3. Best Sales Executive — most SOs prepared this month
    sales_row = db.query(
        SalesOrder.PREPARED_BY,
        func.count(SalesOrder.ID).label("c"),
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0).label("v"),
    ).filter(
        SalesOrder.SO_DATE >= this_month_first,
        SalesOrder.STATUS != "CANCELLED",
        SalesOrder.PREPARED_BY.isnot(None),
    ).group_by(SalesOrder.PREPARED_BY).order_by(
        func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0).desc()
    ).first()

    best_sales = None

    if sales_row and sales_row[0]:

        emp = db.query(Employee).filter(Employee.ID == sales_row[0]).first()

        if emp:

            best_sales = {
                **_serialize_emp(emp, sales_row[1], f"{sales_row[1]} order(s)"),
                "badge": "📈 Top Sales Executive",
                "badge_color": "info",
                "subtitle": f"₹{float(sales_row[2] or 0)/100000:.1f}L closed this month",
            }

    # --- 4. Best Production Engineer — most WO stages DONE this month
    prod_row = db.query(
        WorkOrderStageProgress.ASSIGNED_TO_ID,
        func.count(WorkOrderStageProgress.ID).label("c"),
    ).filter(
        WorkOrderStageProgress.STATUS == "DONE",
        WorkOrderStageProgress.ASSIGNED_TO_ID.isnot(None),
        WorkOrderStageProgress.COMPLETED_AT >= datetime(
            this_month_first.year, this_month_first.month, 1
        ) if hasattr(WorkOrderStageProgress, "COMPLETED_AT") else True,
    ).group_by(WorkOrderStageProgress.ASSIGNED_TO_ID).order_by(
        func.count(WorkOrderStageProgress.ID).desc()
    ).first()

    best_engineer = None

    if prod_row and prod_row[0]:

        emp = db.query(Employee).filter(Employee.ID == prod_row[0]).first()

        if emp:

            best_engineer = {
                **_serialize_emp(emp, prod_row[1], f"{prod_row[1]} stage(s)"),
                "badge": "🛠 Top Production Engineer",
                "badge_color": "warn",
                "subtitle": f"{prod_row[1]} WO stage(s) completed",
            }

    # --- 5. Best Team — department with highest average performance score
    dept_row = db.query(
        Employee.DEPARTMENT_ID,
        func.avg(PerformanceScore.OVERALL_STARS).label("avg_stars"),
        func.count(PerformanceScore.ID).label("n"),
    ).join(
        PerformanceScore, PerformanceScore.EMPLOYEE_ID == Employee.ID
    ).filter(
        Employee.STATUS == "ACTIVE",
        Employee.DEPARTMENT_ID.isnot(None),
    ).group_by(Employee.DEPARTMENT_ID).order_by(
        func.avg(PerformanceScore.OVERALL_STARS).desc()
    ).first()

    best_team = None

    if dept_row and dept_row[0]:

        dept = db.query(Department).filter(Department.ID == dept_row[0]).first()

        if dept:

            avg = float(dept_row[1] or 0)

            best_team = {
                "id":          dept.ID,
                "name":        dept.NAME,
                "code":        dept.CODE if hasattr(dept, "CODE") else None,
                "designation": f"{dept_row[2]} members rated",
                "photo_url":   None,
                "score":       round(avg, 1),
                "score_label": f"{avg:.1f}/5.0 avg",
                "initial":     (dept.NAME[0] if dept.NAME else "?").upper(),
                "badge":       "👥 Best Team",
                "badge_color": "purple",
                "subtitle":    f"Average {avg:.1f}★ across team",
            }

    return {
        "as_of": now.isoformat(),
        "categories": [c for c in [
            eom, best_attendance, best_sales, best_engineer, best_team
        ] if c],
    }


# =====================================================================
# 8. ANALYTICS — per-metric time series
# =====================================================================

import calendar


def _month_buckets(months: int):
    """Yields (year, month, label) tuples for the last N months,
    oldest first."""

    now = datetime.now()

    y, m = now.year, now.month

    out = []

    for _ in range(months):

        out.append((y, m, calendar.month_abbr[m] + f" {y % 100:02d}"))

        m -= 1

        if m == 0:

            m = 12

            y -= 1

    return list(reversed(out))


def _months_from_range(range_str: str) -> int:

    table = {"3m": 3, "6m": 6, "12m": 12, "1y": 12, "24m": 24, "2y": 24}

    return table.get(range_str, 6)


def _series_for_metric(db: Session, metric: str, months: int) -> dict:

    buckets = _month_buckets(months)

    labels = [b[2] for b in buckets]

    series = []

    if metric == "revenue":

        for y, m, _ in buckets:

            v = db.query(
                func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0)
            ).filter(
                extract("year",  SalesOrder.SO_DATE) == y,
                extract("month", SalesOrder.SO_DATE) == m,
                SalesOrder.STATUS != "CANCELLED",
            ).scalar() or 0.0

            series.append(round(float(v), 2))

    elif metric == "sales":

        for y, m, _ in buckets:

            v = db.query(func.count(SalesOrder.ID)).filter(
                extract("year",  SalesOrder.SO_DATE) == y,
                extract("month", SalesOrder.SO_DATE) == m,
                SalesOrder.STATUS != "CANCELLED",
            ).scalar() or 0

            series.append(int(v))

    elif metric == "customers":

        # Cumulative: total customers as-of end of each month
        for y, m, _ in buckets:

            last_day = date(y, m, calendar.monthrange(y, m)[1])

            if hasattr(Customer, "CREATED_AT"):

                v = db.query(func.count(Customer.ID)).filter(
                    Customer.CREATED_AT <= datetime.combine(last_day, datetime.max.time())
                ).scalar() or 0

            else:

                # Fallback if no CREATED_AT — use total count
                v = db.query(func.count(Customer.ID)).scalar() or 0

            series.append(int(v))

    elif metric == "production":

        # Work orders completed per month
        if hasattr(WorkOrder, "COMPLETED_AT"):

            date_col = WorkOrder.COMPLETED_AT

        elif hasattr(WorkOrder, "UPDATED_AT"):

            date_col = WorkOrder.UPDATED_AT

        else:

            date_col = WorkOrder.CREATED_AT if hasattr(WorkOrder, "CREATED_AT") else None

        for y, m, _ in buckets:

            if date_col is None:

                series.append(0)

                continue

            v = db.query(func.count(WorkOrder.ID)).filter(
                extract("year",  date_col) == y,
                extract("month", date_col) == m,
                WorkOrder.STATUS == "DONE",
            ).scalar() or 0

            series.append(int(v))

    elif metric == "inventory":

        # Proxy for inventory consumption: count of WO stage progress
        # rows DONE per month (each represents real material movement
        # on the shop floor).
        for y, m, _ in buckets:

            if not hasattr(WorkOrderStageProgress, "COMPLETED_AT"):

                series.append(0)

                continue

            v = db.query(func.count(WorkOrderStageProgress.ID)).filter(
                extract("year",  WorkOrderStageProgress.COMPLETED_AT) == y,
                extract("month", WorkOrderStageProgress.COMPLETED_AT) == m,
                WorkOrderStageProgress.STATUS == "DONE",
            ).scalar() or 0

            series.append(int(v))

    else:

        series = [0] * len(labels)

    total = sum(series)

    # Trend: last bucket vs previous
    trend = None

    if len(series) >= 2:

        last = series[-1]

        prev = series[-2]

        if prev == 0 and last == 0:

            trend = {"direction": "flat", "pct": 0}

        elif prev == 0:

            trend = {"direction": "up", "pct": 100}

        else:

            change = ((last - prev) / abs(prev)) * 100

            if abs(change) < 0.5:

                trend = {"direction": "flat", "pct": 0}

            else:

                trend = {
                    "direction": "up" if change > 0 else "down",
                    "pct": round(abs(change), 1),
                }

    return {
        "metric": metric,
        "range":  f"{months}m",
        "labels": labels,
        "series": series,
        "total":  round(total, 2) if metric == "revenue" else int(total),
        "trend":  trend,
        "as_of":  datetime.now().isoformat(),
    }


@router.get("/analytics/{metric}")
def analytics(
    metric: str,
    range: str = "6m",
    db: Session = Depends(get_db),
):
    """Time series for one of: revenue, sales, customers, production, inventory.

    Range: 3m / 6m / 12m / 24m."""

    allowed = {"revenue", "sales", "customers", "production", "inventory"}

    if metric not in allowed:

        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail=f"Unknown metric '{metric}'. Allowed: {sorted(allowed)}"
        )

    months = _months_from_range(range)

    return _series_for_metric(db, metric, months)
