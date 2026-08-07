from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.database.database import get_db

from datetime import date

from app.models.models import (
    Employee,
    CustomerProject,
    Task,
    Inventory,
    Customer,
    Role,
    Attendance
)

router = APIRouter()


@router.get("/dashboard-stats")
def dashboard_stats(
    db: Session = Depends(get_db)
):

    total_employees = db.query(
        func.count(Employee.ID)
    ).scalar() or 0

    total_projects = db.query(
        func.count(CustomerProject.ID)
    ).scalar() or 0

    pending_tasks = db.query(
        func.count(Task.ID)
    ).filter(
        Task.STATUS == "PENDING"
    ).scalar() or 0

    in_progress_tasks = db.query(
        func.count(Task.ID)
    ).filter(
        Task.STATUS == "IN_PROGRESS"
    ).scalar() or 0

    completed_tasks = db.query(
        func.count(Task.ID)
    ).filter(
        Task.STATUS == "COMPLETED"
    ).scalar() or 0

    on_hold_tasks = db.query(
        func.count(Task.ID)
    ).filter(
        Task.STATUS == "ON_HOLD"
    ).scalar() or 0

    total_tasks = db.query(
        func.count(Task.ID)
    ).scalar() or 0

    inventory_items = db.query(
        func.count(Inventory.ID)
    ).scalar() or 0

    total_stock = db.query(
        func.coalesce(
            func.sum(Inventory.QUANTITY),
            0
        )
    ).scalar() or 0

    inventory_value = db.query(
        func.coalesce(
            func.sum(
                Inventory.QUANTITY * Inventory.UNIT_PRICE
            ),
            0
        )
    ).scalar() or 0

    today = date.today()

    present_today = db.query(
        func.count(Attendance.ID)
    ).filter(
        Attendance.DATE == today,
        Attendance.STATUS == "PRESENT"
    ).scalar() or 0

    late_today = db.query(
        func.count(Attendance.ID)
    ).filter(
        Attendance.DATE == today,
        Attendance.STATUS == "LATE"
    ).scalar() or 0

    absent_today = db.query(
        func.count(Attendance.ID)
    ).filter(
        Attendance.DATE == today,
        Attendance.STATUS == "ABSENT"
    ).scalar() or 0

    return {
        "total_employees": total_employees,
        "total_projects": total_projects,
        "total_tasks": total_tasks,
        "pending_tasks": pending_tasks,
        "in_progress_tasks": in_progress_tasks,
        "completed_tasks": completed_tasks,
        "on_hold_tasks": on_hold_tasks,
        "inventory_items": inventory_items,
        "total_stock": total_stock,
        "inventory_value": float(inventory_value),
        "present_today": present_today,
        "late_today": late_today,
        "absent_today": absent_today
    }


@router.get("/chart-data")
def chart_data(
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    # Tasks by status (pie chart)
    task_rows = db.query(
        Task.STATUS,
        func.count(Task.ID)
    ).group_by(Task.STATUS).all()

    tasks_by_status = [
        {
            "name": status or "UNKNOWN",
            "value": count
        }
        for status, count in task_rows
    ]

    # Projects by status (bar chart)
    project_rows = db.query(
        CustomerProject.STATUS,
        func.count(CustomerProject.ID)
    ).group_by(CustomerProject.STATUS).all()

    projects_by_status = [
        {
            "name": status or "UNKNOWN",
            "value": count
        }
        for status, count in project_rows
    ]

    # Projects per customer (bar chart)
    customer_rows = db.query(
        Customer.CUSTOMER_NAME,
        func.count(CustomerProject.ID)
    ).outerjoin(
        CustomerProject,
        CustomerProject.CUSTOMER_ID == Customer.ID
    ).group_by(
        Customer.ID,
        Customer.CUSTOMER_NAME
    ).all()

    projects_per_customer = [
        {
            "name": name or "Unnamed",
            "value": count
        }
        for name, count in customer_rows
    ]

    # Inventory aggregated by material name (bar chart).
    # Sums quantity and total value across all companies so
    # the frontend can offer a chip-row filter without
    # exploding to thousands of rows.
    inv_q = db.query(
        Inventory.MATERIAL_NAME,
        func.coalesce(
            func.sum(Inventory.QUANTITY), 0
        ).label("total_qty"),
        func.coalesce(
            func.sum(
                Inventory.QUANTITY * Inventory.UNIT_PRICE
            ),
            0
        ).label("total_value")
    ).group_by(Inventory.MATERIAL_NAME)

    if vendor_id is not None:

        inv_q = inv_q.filter(Inventory.VENDOR_ID == vendor_id)

    inv_rows = inv_q.all()

    inventory_summary = sorted(
        [
            {
                "name": name or "Unnamed",
                "quantity": int(qty or 0),
                "value": float(value or 0.0)
            }
            for name, qty, value in inv_rows
        ],
        key=lambda x: x["value"],
        reverse=True
    )

    # Employees per role (pie chart)
    role_rows = db.query(
        Role.NAME,
        func.count(Employee.ID)
    ).outerjoin(
        Employee,
        Employee.ROLE_ID == Role.ID
    ).group_by(
        Role.ID,
        Role.NAME
    ).all()

    employees_per_role = [
        {
            "name": role_name or "Unassigned",
            "value": count
        }
        for role_name, count in role_rows
    ]

    # Employees with no role at all
    unassigned_count = db.query(
        func.count(Employee.ID)
    ).filter(
        Employee.ROLE_ID.is_(None)
    ).scalar() or 0

    if unassigned_count > 0:

        employees_per_role.append({
            "name": "No Role",
            "value": unassigned_count
        })

    # Attendance today (pie chart)
    today = date.today()

    att_rows = db.query(
        Attendance.STATUS,
        func.count(Attendance.ID)
    ).filter(
        Attendance.DATE == today
    ).group_by(Attendance.STATUS).all()

    attendance_today = [
        {
            "name": status or "UNKNOWN",
            "value": count
        }
        for status, count in att_rows
    ]

    return {
        "tasks_by_status": tasks_by_status,
        "projects_by_status": projects_by_status,
        "projects_per_customer": projects_per_customer,
        "inventory_summary": inventory_summary,
        "employees_per_role": employees_per_role,
        "attendance_today": attendance_today
    }
