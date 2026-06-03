"""Admin Dashboard — single endpoint that returns all 12 KPI metrics
in one round trip so the frontend can render the dashboard with one
fetch + one re-fetch on each refresh cycle.

Endpoint: GET /admin/dashboard-stats

Response keys mirror the 12 tile labels:
  total_customers, total_quotations, total_sales_orders,
  active_projects, purchase_orders, inventory_value,
  employees_present_today, leave_requests_pending,
  production_status (object), monthly_revenue,
  pending_payments, ai_notifications
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, extract
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
    Notification,
)


router = APIRouter(prefix="/admin", tags=["Admin Dashboard"])


@router.get("/dashboard-stats")
def admin_dashboard_stats(
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """All 12 admin-dashboard KPIs in one shot.

    Optional ?vendor_id= filters every metric where the table has a
    VENDOR_ID. Omitted by default so the dashboard shows the whole
    company unless the caller chooses otherwise."""

    today = date.today()

    now   = datetime.now()

    def _scope(q, model):
        """Apply vendor_id filter only if the column exists + caller asked."""

        if vendor_id is not None and hasattr(model, "VENDOR_ID"):

            return q.filter(model.VENDOR_ID == vendor_id)

        return q

    # 1. Total Customers
    total_customers = _scope(db.query(func.count(Customer.ID)), Customer).scalar() or 0

    # 2. Total Quotations
    total_quotations = _scope(db.query(func.count(Quotation.ID)), Quotation).scalar() or 0

    # 3. Total Sales Orders (exclude CANCELLED)
    total_sales_orders = _scope(
        db.query(func.count(SalesOrder.ID)).filter(
            SalesOrder.STATUS != "CANCELLED"
        ),
        SalesOrder
    ).scalar() or 0

    # 4. Active Projects
    active_projects = _scope(
        db.query(func.count(Project.ID)).filter(
            ~Project.STATUS.in_(["COMPLETED", "CANCELLED", "CLOSED"])
        ),
        Project
    ).scalar() or 0

    # 5. Purchase Orders (exclude CANCELLED)
    purchase_orders_count = _scope(
        db.query(func.count(PurchaseOrder.ID)).filter(
            PurchaseOrder.STATUS != "CANCELLED"
        ),
        PurchaseOrder
    ).scalar() or 0

    # 6. Inventory Value — SUM(QUANTITY × UNIT_PRICE)
    inventory_value = _scope(
        db.query(
            func.coalesce(
                func.sum(Inventory.QUANTITY * Inventory.UNIT_PRICE),
                0.0
            )
        ),
        Inventory
    ).scalar() or 0.0

    # 7. Employees Present Today
    employees_present_today = db.query(func.count(Attendance.ID)).filter(
        Attendance.DATE == today,
        Attendance.STATUS.in_(["PRESENT", "LATE"])
    ).scalar() or 0

    # 8. Leave Requests Pending
    leave_requests_pending = _scope(
        db.query(func.count(LeaveRequest.ID)).filter(
            LeaveRequest.STATUS == "PENDING_APPROVAL"
        ),
        LeaveRequest
    ).scalar() or 0

    # 9. Production Status — breakdown
    production_breakdown_rows = (
        _scope(
            db.query(WorkOrder.STATUS, func.count(WorkOrder.ID)),
            WorkOrder
        )
        .group_by(WorkOrder.STATUS)
        .all()
    )

    production_status = {
        "PLANNED": 0,
        "IN_PROGRESS": 0,
        "ON_HOLD": 0,
        "DONE": 0,
        "CANCELLED": 0,
        "TOTAL_ACTIVE": 0,   # PLANNED + IN_PROGRESS
    }

    for status, count in production_breakdown_rows:

        if status in production_status:

            production_status[status] = int(count or 0)

    production_status["TOTAL_ACTIVE"] = (
        production_status["PLANNED"] + production_status["IN_PROGRESS"]
    )

    # 10. Monthly Revenue — SUM(GRAND_TOTAL) where SO_DATE in current month
    monthly_revenue = _scope(
        db.query(
            func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0)
        ).filter(
            extract("year",  SalesOrder.SO_DATE) == now.year,
            extract("month", SalesOrder.SO_DATE) == now.month,
            SalesOrder.STATUS != "CANCELLED"
        ),
        SalesOrder
    ).scalar() or 0.0

    # 11. Pending Payments — sum of (GRAND_TOTAL - ADVANCE_RECEIVED) on
    # active SOs (CONFIRMED / IN_PRODUCTION / SHIPPED / AWAITING_ADVANCE)
    pending_payments_row = _scope(
        db.query(
            func.coalesce(func.sum(SalesOrder.GRAND_TOTAL), 0.0),
            func.coalesce(func.sum(SalesOrder.ADVANCE_RECEIVED), 0.0)
        ).filter(
            SalesOrder.STATUS.in_([
                "AWAITING_ADVANCE",
                "CONFIRMED",
                "IN_PRODUCTION",
                "SHIPPED",
                "DELIVERED"
            ])
        ),
        SalesOrder
    ).first()

    pending_payments = max(
        0.0,
        round((pending_payments_row[0] or 0.0) - (pending_payments_row[1] or 0.0), 2)
    )

    # 12. AI Notifications — unread
    ai_notifications = _scope(
        db.query(func.count(Notification.ID)).filter(
            Notification.IS_READ == 0
        ),
        Notification
    ).scalar() or 0

    return {
        "as_of": now.isoformat(),
        "vendor_id": vendor_id,
        "total_customers":         int(total_customers),
        "total_quotations":        int(total_quotations),
        "total_sales_orders":      int(total_sales_orders),
        "active_projects":         int(active_projects),
        "purchase_orders":         int(purchase_orders_count),
        "inventory_value":         round(float(inventory_value or 0.0), 2),
        "employees_present_today": int(employees_present_today),
        "leave_requests_pending":  int(leave_requests_pending),
        "production_status":       production_status,
        "monthly_revenue":         round(float(monthly_revenue or 0.0), 2),
        "pending_payments":        pending_payments,
        "ai_notifications":        int(ai_notifications),
    }
