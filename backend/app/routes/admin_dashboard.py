"""Admin Dashboard — single endpoint that returns KPI metrics in one
round trip so the frontend can render the dashboard with one
fetch + one re-fetch on each refresh cycle.

Endpoint: GET /admin/dashboard-stats

Response keys mirror the tile labels:
  total_customers, purchase_orders, inventory_value,
  employees_present_today, leave_requests_pending,
  ai_notifications
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Customer,
    PurchaseOrder,
    Inventory,
    Attendance,
    LeaveRequest,
    Notification,
)


from app.auth.auth_bearer import get_current_admin

router = APIRouter(prefix="/admin", tags=["Admin Dashboard"])


@router.get("/dashboard-stats", dependencies=[Depends(get_current_admin)])
def admin_dashboard_stats(
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """All 11 admin-dashboard KPIs in one shot.

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
        "purchase_orders":         int(purchase_orders_count),
        "inventory_value":         round(float(inventory_value or 0.0), 2),
        "employees_present_today": int(employees_present_today),
        "leave_requests_pending":  int(leave_requests_pending),
        "ai_notifications":        int(ai_notifications),
    }
