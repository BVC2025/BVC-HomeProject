"""
Cross-module 360° endpoints + workflow snapshot.

Every BVC24 module already has its own CRUD endpoints, but to
*connect* them — so anyone can drill from one entity into every
related piece of data in one click — we expose unified profile
endpoints here. One HTTP call returns the full picture.

Routes
------
  GET /connect/employee/{id}/360        — tasks + attendance + leave +
                                          performance + scans
  GET /connect/supplier/{id}/360        — supplier profile
  GET /connect/workflow/snapshot        — live counts at every step of the
                                          BVC24 flow, for the Workflow page
"""

from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database.database import get_db

from app.models.models import (
    Employee,
    Department,
    Customer,
    TaskAssignment,
    Attendance,
    Inventory,
    Supplier,
    LeaveRequest,
    LeaveBalance,
    BiometricEvent,
    DailyAllocation,
)


from app.auth.auth_bearer import get_current_admin

router = APIRouter(prefix="/connect", tags=["Connectivity"])


# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

def _iso(dt):

    if not dt:

        return None

    try:

        return dt.isoformat()

    except Exception:

        return str(dt)


# ================================================================
# EMPLOYEE 360°
# ================================================================

@router.get("/employee/{employee_id}/360", dependencies=[Depends(get_current_admin)])
def employee_360(employee_id: str, db: Session = Depends(get_db)):
    """Returns everything connected to one employee in one payload.

    Pulls from: Employee, Department, TaskAssignment, Attendance,
    LeaveRequest, LeaveBalance, BiometricEvent, DailyAllocation +
    performance score.
    """

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    dept = (
        db.query(Department)
        .filter(Department.ID == emp.DEPARTMENT_ID)
        .first()
        if emp.DEPARTMENT_ID else None
    )

    today = date.today()

    # ---- Today's attendance ----
    att = (
        db.query(Attendance)
        .filter(
            Attendance.EMPLOYEE_ID == emp.ID,
            Attendance.DATE == today
        )
        .first()
    )

    # ---- Active + recent tasks ----
    active_tasks = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            TaskAssignment.TASK_STATUS.in_(
                ["PENDING", "IN_PROGRESS", "ON_HOLD"]
            )
        )
        .order_by(TaskAssignment.ASSIGNED_DATE.desc())
        .limit(20)
        .all()
    )

    completed_today = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            TaskAssignment.ASSIGNED_DATE == today,
            TaskAssignment.TASK_STATUS.in_(["DONE", "COMPLETED"])
        )
        .all()
    )

    # ---- Recent biometric scans ----
    recent_scans = (
        db.query(BiometricEvent)
        .filter(BiometricEvent.EMPLOYEE_ID == emp.ID)
        .order_by(BiometricEvent.EVENT_TIME.desc())
        .limit(10)
        .all()
    )

    # ---- Leave balance + recent requests ----
    bal = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.EMPLOYEE_ID == emp.ID,
            LeaveBalance.YEAR == today.year
        )
        .first()
    )

    leave_requests = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.EMPLOYEE_ID == emp.ID)
        .order_by(LeaveRequest.CREATED_AT.desc())
        .limit(10)
        .all()
    )

    # ---- Performance score (last 30 days) ----
    try:

        from app.services.performance_service import score_employee

        perf = score_employee(
            db, emp, today - timedelta(days=29), today
        )

    except Exception:

        perf = None

    return {
        "employee": {
            "ID": emp.ID,
            "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
            "NAME": emp.NAME,
            "EMAIL": emp.EMAIL,
            "PHONE": emp.PHONE,
            "DEPARTMENT": dept.NAME if dept else None,
            "DEPARTMENT_CODE": dept.DEPARTMENT_CODE if dept else None,
            "SKILLS": emp.SKILLS,
            "FINGERPRINT_ID": emp.FINGERPRINT_ID,
            "STATUS": emp.STATUS,
            "JOINING_DATE": _iso(emp.JOINING_DATE),
            "SHIFT_START": _iso(emp.SHIFT_START),
            "SHIFT_END": _iso(emp.SHIFT_END)
        },
        "today_attendance": {
            "CHECK_IN": _iso(att.CHECK_IN) if att else None,
            "CHECK_OUT": _iso(att.CHECK_OUT) if att else None,
            "STATUS": att.STATUS if att else "NOT_CHECKED_IN",
            "WORKED_HOURS": att.WORKED_HOURS if att else None,
            "OVERTIME_HOURS": att.OVERTIME_HOURS if att else None
        } if att else None,
        "active_tasks": [
            {
                "TASK_ID": t.TASK_ID,
                "TASK_NAME": t.TASK_NAME,
                "TASK_DETAILS": t.TASK_DETAILS,
                "STATUS": t.TASK_STATUS,
                "ASSIGNED_DATE": _iso(t.ASSIGNED_DATE),
                "DUE_DATE": _iso(t.DUE_DATE),
                "START_TIME": _iso(t.START_TIME),
                "END_TIME": _iso(t.END_TIME)
            }
            for t in active_tasks
        ],
        "completed_today_count": len(completed_today),
        "recent_scans": [
            {
                "ID": s.ID,
                "DEVICE_ID": s.DEVICE_ID,
                "EVENT_TIME": _iso(s.EVENT_TIME),
                "RESULT": s.RESULT,
                "VERIFY_MODE": s.VERIFY_MODE
            }
            for s in recent_scans
        ],
        "leave_balance": (
            {
                "YEAR": bal.YEAR,
                "CASUAL": {
                    "total": bal.CASUAL_TOTAL,
                    "used": bal.CASUAL_USED,
                    "remaining": round(bal.CASUAL_TOTAL - bal.CASUAL_USED, 1)
                },
                "SICK": {
                    "total": bal.SICK_TOTAL,
                    "used": bal.SICK_USED,
                    "remaining": round(bal.SICK_TOTAL - bal.SICK_USED, 1)
                },
                "EARNED": {
                    "total": bal.EARNED_TOTAL,
                    "used": bal.EARNED_USED,
                    "remaining": round(bal.EARNED_TOTAL - bal.EARNED_USED, 1)
                }
            }
            if bal else None
        ),
        "leave_requests": [
            {
                "ID": lv.ID,
                "LEAVE_TYPE": lv.LEAVE_TYPE,
                "START_DATE": _iso(lv.START_DATE),
                "END_DATE": _iso(lv.END_DATE),
                "DAYS": lv.DAYS,
                "REASON": lv.REASON,
                "STATUS": lv.STATUS
            }
            for lv in leave_requests
        ],
        "performance": perf
    }


# project_360() removed — GET /connect/project/{id}/360 was entirely
# CustomerProject-shaped (table project_legacy, removed) and had no
# viable repoint onto the newer Project catalog (incompatible schema:
# no CUSTOMER_ID/STATUS/DEPARTMENT_ID/TARGET_DATE, UUID vs int PK).
# It was already unreachable in practice — the only live caller
# (Projects.jsx via EntityDrawer) passes the newer catalog's UUID ID
# into this endpoint's int-typed path param, which FastAPI already
# rejected with a 422.


# customer_360() removed — GET /connect/customer/{id}/360 had zero
# remaining callers once EntityDrawer.jsx's `type="customer"` branch
# (its only invoker, via the now-deleted Customers.jsx) was retired
# along with /customers in favor of /customer-master.



# ================================================================
# SUPPLIER 360°
# ================================================================

@router.get("/supplier/{supplier_id}/360", dependencies=[Depends(get_current_admin)])
def supplier_360(supplier_id: int, db: Session = Depends(get_db)):

    sup = db.query(Supplier).filter(Supplier.ID == supplier_id).first()

    if not sup:

        raise HTTPException(status_code=404, detail="Supplier not found")

    return {
        "supplier": {
            "ID": sup.ID,
            "SUPPLIER_CODE": sup.SUPPLIER_CODE,
            "COMPANY_NAME": sup.COMPANY_NAME,
            "CONTACT_PERSON": sup.CONTACT_PERSON,
            "PHONE": sup.PHONE,
            "EMAIL": sup.EMAIL,
            "CITY": sup.CITY,
            "STATE": sup.STATE,
            "PINCODE": sup.PINCODE,
            "ADDRESS_LINE1": sup.ADDRESS_LINE1,
            "ADDRESS_LINE2": sup.ADDRESS_LINE2,
            "GST_NUMBER": sup.GST_NUMBER,
            "PAN_NUMBER": sup.PAN_NUMBER,
            "BANK_NAME": sup.BANK_NAME,
            "ACCOUNT_NUMBER": sup.ACCOUNT_NUMBER,
            "IFSC_CODE": sup.IFSC_CODE,
            "CATEGORY": sup.CATEGORY,
            "PAYMENT_TERMS": sup.PAYMENT_TERMS,
            "STATUS": sup.STATUS
        }
    }


# ================================================================
# WORKFLOW SNAPSHOT — live counts at every step of BVC24 flow
# ================================================================

@router.get("/workflow/snapshot", dependencies=[Depends(get_current_admin)])
def workflow_snapshot(db: Session = Depends(get_db)):
    """One call that returns counts at every node of the BVC24 flow:

        Customers → Projects → Work Orders → BOM/Suppliers
                                          → Process Stages → Tasks
                                          → Biometric Scans → Attendance
                                          → Allocations → Quality
                                          → NCRs → MD Performance
                                          → Leave

    The Workflow page renders these as a connected diagram so the
    user can see end-to-end at a glance.
    """

    today = date.today()

    return {
        "as_of": datetime.now().isoformat(),

        "people": {
            "employees_active": db.query(Employee).filter(
                Employee.STATUS == "ACTIVE"
            ).count(),
            "departments": db.query(Department).count(),
            "customers": db.query(Customer).count(),
            "suppliers_active": db.query(Supplier).filter(
                Supplier.STATUS == "ACTIVE"
            ).count()
        },

        "biometric": {
            "scans_total": db.query(BiometricEvent).count(),
            "scans_today": db.query(BiometricEvent).filter(
                func.date(BiometricEvent.EVENT_TIME) == today
            ).count(),
            "in_office_now": db.query(Attendance).filter(
                Attendance.DATE == today,
                Attendance.CHECK_IN.isnot(None),
                Attendance.CHECK_OUT.is_(None)
            ).count(),
            "checked_out_today": db.query(Attendance).filter(
                Attendance.DATE == today,
                Attendance.CHECK_OUT.isnot(None)
            ).count()
        },

        "tasks": {
            "allocations_today": db.query(DailyAllocation).filter(
                DailyAllocation.ALLOC_DATE == today
            ).count(),
            "tasks_pending": db.query(TaskAssignment).filter(
                TaskAssignment.TASK_STATUS == "PENDING"
            ).count(),
            "tasks_in_progress": db.query(TaskAssignment).filter(
                TaskAssignment.TASK_STATUS == "IN_PROGRESS"
            ).count(),
            "tasks_completed_today": db.query(TaskAssignment).filter(
                TaskAssignment.ASSIGNED_DATE == today,
                TaskAssignment.TASK_STATUS.in_(["DONE", "COMPLETED"])
            ).count()
        },

        "leave": {
            "pending_md_approval": db.query(LeaveRequest).filter(
                LeaveRequest.STATUS == "PENDING_APPROVAL"
            ).count(),
            "approved_total": db.query(LeaveRequest).filter(
                LeaveRequest.STATUS == "APPROVED"
            ).count(),
            "on_leave_today": db.query(LeaveRequest).filter(
                LeaveRequest.STATUS == "APPROVED",
                LeaveRequest.START_DATE <= today,
                LeaveRequest.END_DATE >= today
            ).count()
        },

        "inventory": {
            "materials": db.query(Inventory).count(),
            "low_stock": db.query(Inventory).filter(
                Inventory.QUANTITY < 10
            ).count(),
            "out_of_stock": db.query(Inventory).filter(
                Inventory.QUANTITY == 0
            ).count()
        }
    }
