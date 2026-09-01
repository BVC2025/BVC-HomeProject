"""Mission Control dashboard aggregators (Phase 2).

Small endpoints that feed the new dashboard panels:

  GET /admin/dashboard/sparklines       7-day series per KPI
  GET /admin/dashboard/health-score     sub-scores + overall + label
"""

from datetime import date, datetime, timedelta
from typing import Dict, List

from fastapi import APIRouter, Depends
from sqlalchemy import func, cast, Date
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Customer,
    PurchaseOrder,
    Inventory,
    Attendance,
    LeaveRequest,
    Notification,
    Employee,
)


from app.auth.auth_bearer import get_current_admin

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


@router.get("/sparklines", dependencies=[Depends(get_current_admin)])
def sparklines(db: Session = Depends(get_db)):
    """Returns a 7-element array for each KPI tile.

    Each item is the daily aggregate for the last 7 days
    (index 0 = 6 days ago, index 6 = today)."""

    return {
        "total_customers":         _count_per_day(db, Customer, Customer.CREATED_AT)
            if hasattr(Customer, "CREATED_AT") else [0]*7,
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


def _label_for_score(s: int) -> str:

    if s >= 90:  return "Excellent Performance"

    if s >= 75:  return "Strong Performance"

    if s >= 60:  return "Steady Performance"

    if s >= 40:  return "Needs Attention"

    return "Critical — Action Required"


@router.get("/health-score", dependencies=[Depends(get_current_admin)])
def health_score(db: Session = Depends(get_db)):
    """Composite business-health score (0-100)."""

    inventory,  inventory_note  = _score_inventory(db)
    hr,         hr_note         = _score_hr(db)

    # Weighted average. Production's own sub-score was removed along
    # with CustomerProject (table project_legacy), and Sales/Finance
    # (both 100% Quotation/SalesOrder-derived) were removed along with
    # CRM & Sales — the remaining 2 weights are renormalized
    # proportionally from the original 5 so they still sum to 1.00.
    weights = {
        "inventory":  0.55,
        "hr":         0.45,
    }

    overall = int(round(
        inventory * weights["inventory"] +
        hr * weights["hr"]
    ))

    # Surface the weakest dimension as an "action" to focus on
    breakdown = [
        ("Inventory",  inventory,  inventory_note),
        ("HR",         hr,         hr_note),
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
            "inventory":  {"value": inventory,  "note": inventory_note},
            "hr":         {"value": hr,         "note": hr_note},
        },
        "weights": weights,
        "actions": actions,
        "as_of": datetime.now().isoformat(),
    }


# =====================================================================
# 5. AI INSIGHT ENGINE — rule-based generator
# =====================================================================
# Scans live data and produces 3-5 actionable insight cards. Each card:
#   { severity, icon, title, body, suggestion, action_url }
# Severity: critical | warning | info | success
# Deterministic + fast; no LLM dependency. Gemini polish optional.

@router.get("/insights", dependencies=[Depends(get_current_admin)])
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

    pending_pos = db.query(func.count(PurchaseOrder.ID)).filter(
        PurchaseOrder.STATUS == "DRAFT"
    ).scalar() or 0

    pending_total = pending_leaves + pending_pos

    if pending_total >= 5:

        cards.append({
            "severity": "info",
            "icon": "✅",
            "title": f"{pending_total} item(s) waiting for your approval",
            "body": (
                f"{pending_leaves} leave / permission · "
                f"{pending_pos} purchase order"
            ),
            "suggestion": "Process them in one batch from the Approval Center.",
            "action_url": "/approvals",
            "action_label": "Open Approval Center",
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

@router.get("/activity-feed", dependencies=[Depends(get_current_admin)])
def activity_feed(
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """Union over recent rows across multiple tables. Each entry has
    a uniform shape so the UI renders them with one component."""

    items = []

    # Recent customers
    for r in db.query(Customer).order_by(Customer.CREATED_AT.desc()).limit(5).all():

        ts = getattr(r, "CREATED_AT", None) or getattr(r, "LEAD_CREATED_DATE", None)
        items.append({
            "ts": ts.isoformat() if ts else datetime.now().isoformat(),
            "kind": "customer",
            "icon": "👤",
            "color": "purple",
            "text": f"Customer {r.NAME or f'#{r.ID}'} added",
            "subtext": (r.COMPANY_NAME or "Customer"),
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

    # Sort by ts desc, cap to `limit`
    items.sort(key=lambda x: x["ts"], reverse=True)

    return {
        "as_of": datetime.now().isoformat(),
        "count": len(items),
        "items": items[:limit],
    }


# =====================================================================
# 7. TOP PERFORMERS — spotlight categories
# =====================================================================
# Sources:
#   1. Employee of the Month  → PerformanceScore.OVERALL_STARS (latest)
#   2. Best Attendance        → count of PRESENT/LATE this month
#   3. Best Team              → average score by department

@router.get("/top-performers", dependencies=[Depends(get_current_admin)])
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

    # --- 3. Best Team — department with highest average performance score
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
                "code":        dept.DEPARTMENT_CODE if hasattr(dept, "DEPARTMENT_CODE") else None,
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
            eom, best_attendance, best_team
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

    if metric == "customers":

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
        "total":  int(total),
        "trend":  trend,
        "as_of":  datetime.now().isoformat(),
    }


@router.get("/analytics/{metric}", dependencies=[Depends(get_current_admin)])
def analytics(
    metric: str,
    range: str = "6m",
    db: Session = Depends(get_db),
):
    """Time series for one of: customers.

    Range: 3m / 6m / 12m / 24m."""

    allowed = {"customers"}

    if metric not in allowed:

        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail=f"Unknown metric '{metric}'. Allowed: {sorted(allowed)}"
        )

    months = _months_from_range(range)

    return _series_for_metric(db, metric, months)
