"""
Cross-module 360° endpoints + workflow snapshot.

Every BVC24 module already has its own CRUD endpoints, but to
*connect* them — so anyone can drill from one entity into every
related piece of data in one click — we expose unified profile
endpoints here. One HTTP call returns the full picture.

Routes
------
  GET /connect/employee/{id}/360        — tasks + attendance + leave +
                                          performance + scans + stages
  GET /connect/project/{id}/360         — work orders + tasks + assigned
                                          employees + customer
  GET /connect/work-order/{id}/360      — model + BOM + stages + inspections
                                          + NCRs + assigned employees
  GET /connect/supplier/{id}/360        — BOM lines using this supplier +
                                          which machine models depend on it
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
    Project,
    Customer,
    TaskAssignment,
    Attendance,
    Inventory,
    Supplier,
    ProductModel,
    BOMItem,
    WorkOrder,
    ProcessStage,
    WorkOrderStageProgress,
    QCChecklistItem,
    QCInspection,
    QCInspectionResult,
    NCR,
    LeaveRequest,
    LeaveBalance,
    BiometricEvent,
    DailyAllocation,
    Vendor,
    Machine
)


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

@router.get("/employee/{employee_id}/360")
def employee_360(employee_id: str, db: Session = Depends(get_db)):
    """Returns everything connected to one employee in one payload.

    Pulls from: Employee, Department, TaskAssignment, Attendance,
    LeaveRequest, LeaveBalance, BiometricEvent, DailyAllocation,
    WorkOrderStageProgress + performance score.
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
        db.query(TaskAssignment, Project)
        .outerjoin(Project, TaskAssignment.PROJECT_ID == Project.ID)
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

    # ---- WO stages currently assigned to this employee ----
    in_progress_stages = (
        db.query(WorkOrderStageProgress, ProcessStage, WorkOrder, ProductModel)
        .join(
            ProcessStage,
            WorkOrderStageProgress.STAGE_ID == ProcessStage.ID
        )
        .join(
            WorkOrder,
            WorkOrderStageProgress.WORK_ORDER_ID == WorkOrder.ID
        )
        .outerjoin(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .filter(
            WorkOrderStageProgress.ASSIGNED_TO_ID == emp.ID,
            WorkOrderStageProgress.STATUS.in_(["IN_PROGRESS", "PENDING"])
        )
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
            "DEPARTMENT_CODE": dept.CODE if dept else None,
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
                "PROJECT_ID": t.PROJECT_ID,
                "PROJECT_NAME": p.PROJECT_NAME if p else None,
                "ASSIGNED_DATE": _iso(t.ASSIGNED_DATE),
                "DUE_DATE": _iso(t.DUE_DATE),
                "START_TIME": _iso(t.START_TIME),
                "END_TIME": _iso(t.END_TIME)
            }
            for t, p in active_tasks
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
        "active_production_stages": [
            {
                "WO_ID": wo.ID,
                "WO_NUMBER": wo.WO_NUMBER,
                "MODEL_NAME": model.MODEL_NAME if model else None,
                "STAGE_NAME": stage.STAGE_NAME,
                "STAGE_TYPE": stage.STAGE_TYPE,
                "PROGRESS_STATUS": progress.STATUS,
                "STARTED_AT": _iso(progress.STARTED_AT)
            }
            for progress, stage, wo, model in in_progress_stages
        ],
        "performance": perf
    }


# ================================================================
# PROJECT 360°
# ================================================================

@router.get("/project/{project_id}/360")
def project_360(project_id: int, db: Session = Depends(get_db)):

    proj = db.query(Project).filter(Project.ID == project_id).first()

    if not proj:

        raise HTTPException(status_code=404, detail="Project not found")

    customer = (
        db.query(Customer)
        .filter(Customer.ID == proj.CUSTOMER_ID)
        .first()
        if proj.CUSTOMER_ID else None
    )

    dept = (
        db.query(Department)
        .filter(Department.ID == proj.DEPARTMENT_ID)
        .first()
        if proj.DEPARTMENT_ID else None
    )

    # ---- Work orders under this project ----
    wos = (
        db.query(WorkOrder, ProductModel)
        .outerjoin(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .filter(WorkOrder.PROJECT_ID == proj.ID)
        .order_by(WorkOrder.CREATED_AT.desc())
        .all()
    )

    # ---- Tasks under this project ----
    tasks = (
        db.query(TaskAssignment, Employee)
        .outerjoin(Employee, TaskAssignment.EMPLOYEE_ID == Employee.ID)
        .filter(TaskAssignment.PROJECT_ID == proj.ID)
        .order_by(TaskAssignment.ASSIGNED_DATE.desc())
        .limit(30)
        .all()
    )

    task_stats = {
        "total": len(tasks),
        "pending": sum(
            1 for t, _ in tasks if t.TASK_STATUS == "PENDING"
        ),
        "in_progress": sum(
            1 for t, _ in tasks if t.TASK_STATUS == "IN_PROGRESS"
        ),
        "completed": sum(
            1 for t, _ in tasks
            if t.TASK_STATUS in ("DONE", "COMPLETED")
        )
    }

    assigned_employees = sorted({
        emp.EMPLOYEE_CODE: {
            "ID": emp.ID,
            "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
            "NAME": emp.NAME
        }
        for _, emp in tasks
        if emp is not None
    }.values(), key=lambda e: e["EMPLOYEE_CODE"])

    # ---- BOM rolled up by project quantity, with supplier links ----
    # Pulls the product's BOM, multiplies by project quantity, and
    # joins each line's PREFERRED_SUPPLIER so the UI can show & swap
    # the supplier per material.
    project_quantity = proj.QUANTITY or 1

    bom_rolled = []

    if proj.PRODUCT_MODEL_ID:

        bom_rows = (
            db.query(BOMItem, Supplier, ProcessStage)
            .outerjoin(
                Supplier, BOMItem.PREFERRED_SUPPLIER_ID == Supplier.ID
            )
            .outerjoin(
                ProcessStage, BOMItem.PROCESS_STAGE_ID == ProcessStage.ID
            )
            .filter(BOMItem.PRODUCT_MODEL_ID == proj.PRODUCT_MODEL_ID)
            .all()
        )

        for item, supplier, stage in bom_rows:

            bom_rolled.append({
                "ID": item.ID,
                "ITEM_NO": item.ITEM_NO,
                "IMAGE_URL": item.IMAGE_URL,
                "MATERIAL_NAME": item.MATERIAL_NAME,
                "PER_UNIT_QUANTITY": item.QUANTITY,
                "TOTAL_QUANTITY": round(
                    (item.QUANTITY or 0) * project_quantity, 3
                ),
                "UNIT": item.UNIT,
                "ITEM_TYPE": item.ITEM_TYPE or "PURCHASE",
                "PREFERRED_SUPPLIER_ID": item.PREFERRED_SUPPLIER_ID,
                "PREFERRED_SUPPLIER_NAME": (
                    supplier.COMPANY_NAME if supplier else None
                ),
                "PREFERRED_SUPPLIER_CODE": (
                    supplier.SUPPLIER_CODE if supplier else None
                ),
                "PROCESS_STAGE_ID": item.PROCESS_STAGE_ID,
                "PROCESS_STAGE_NAME": (
                    stage.STAGE_NAME if stage else None
                ),
                "NOTES": item.NOTES
            })

    # ---- Vendor's supplier directory, so the UI picker has options
    # Frontend often passes vendor_id=1 even when the BVC vendor row
    # actually has a different ID (e.g. 4 — created after a tenant
    # seed). Try strict vendor match first, then fall back to BVC
    # by name, then any supplier. Matches the production.py pattern.
    sup_rows = []

    if proj.VENDOR_ID:

        sup_rows = (
            db.query(Supplier)
            .filter(Supplier.VENDOR_ID == proj.VENDOR_ID)
            .order_by(Supplier.COMPANY_NAME)
            .all()
        )

    if not sup_rows:

        bvc = db.query(Vendor).filter(
            Vendor.VENDOR_NAME == "Bharath Vending Corporation"
        ).first()

        if bvc:

            sup_rows = (
                db.query(Supplier)
                .filter(Supplier.VENDOR_ID == bvc.ID)
                .order_by(Supplier.COMPANY_NAME)
                .all()
            )

    if not sup_rows:

        sup_rows = (
            db.query(Supplier)
            .order_by(Supplier.COMPANY_NAME)
            .all()
        )

    suppliers_for_picker = [
        {
            "ID": s.ID,
            "SUPPLIER_CODE": s.SUPPLIER_CODE,
            "COMPANY_NAME": s.COMPANY_NAME,
            "CATEGORY": getattr(s, "CATEGORY", None)
        }
        for s in sup_rows
    ]

    return {
        "project": {
            "ID": proj.ID,
            "PROJECT_NAME": proj.PROJECT_NAME,
            "DESCRIPTION": proj.DESCRIPTION,
            "STATUS": proj.STATUS,
            "PRIORITY": proj.PRIORITY,
            "SKILLS_REQUIRED": proj.SKILLS_REQUIRED,
            "DEPARTMENT": dept.NAME if dept else None,
            "PRODUCT_MODEL_ID": proj.PRODUCT_MODEL_ID,
            "QUANTITY": proj.QUANTITY,
            "TARGET_DATE": _iso(proj.TARGET_DATE)
        },
        "customer": (
            {
                "ID": customer.ID,
                "NAME": customer.CUSTOMER_NAME,
                "PHONE": customer.PHONE,
                "EMAIL": customer.EMAIL,
                "ADDRESS": customer.ADDRESS
            }
            if customer else None
        ),
        "work_orders": [
            {
                "ID": wo.ID,
                "WO_NUMBER": wo.WO_NUMBER,
                "MODEL_NAME": model.MODEL_NAME if model else None,
                "MODEL_CODE": model.MODEL_CODE if model else None,
                "QUANTITY": wo.QUANTITY,
                "STATUS": wo.STATUS,
                "PLANNED_START_DATE": _iso(wo.PLANNED_START_DATE),
                "PLANNED_END_DATE": _iso(wo.PLANNED_END_DATE)
            }
            for wo, model in wos
        ],
        "task_stats": task_stats,
        "tasks": [
            {
                "TASK_ID": t.TASK_ID,
                "TASK_NAME": t.TASK_NAME,
                "STATUS": t.TASK_STATUS,
                "EMPLOYEE_NAME": emp.NAME if emp else None,
                "EMPLOYEE_CODE": emp.EMPLOYEE_CODE if emp else None,
                "ASSIGNED_DATE": _iso(t.ASSIGNED_DATE)
            }
            for t, emp in tasks
        ],
        "assigned_employees": assigned_employees,
        "bom_rolled_up": bom_rolled,
        "project_quantity": project_quantity,
        "suppliers_for_picker": suppliers_for_picker
    }


# ================================================================
# CUSTOMER 360°
# ================================================================

@router.get("/customer/{customer_id}/360")
def customer_360(customer_id: int, db: Session = Depends(get_db)):
    """
    Returns everything connected to one customer in one payload —
    profile, all projects, work orders, machine models being built,
    BOM rollups, totals.

    This is the heart of the customer-centric experience: BVC24
    builds machines specifically for customers, so the customer
    record must surface the production pipeline tied to them.
    """

    customer = (
        db.query(Customer)
        .filter(Customer.ID == customer_id)
        .first()
    )

    if not customer:

        raise HTTPException(status_code=404, detail="Customer not found")

    # ---- Projects belonging to this customer ----
    projects = (
        db.query(Project, Department)
        .outerjoin(Department, Project.DEPARTMENT_ID == Department.ID)
        .filter(Project.CUSTOMER_ID == customer.ID)
        .order_by(Project.ID.desc())
        .all()
    )

    project_ids = [p.ID for p, _ in projects]

    # ---- Work orders under those projects ----
    work_orders = []

    if project_ids:

        work_orders = (
            db.query(WorkOrder, ProductModel, Project)
            .outerjoin(
                ProductModel,
                WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
            )
            .outerjoin(Project, WorkOrder.PROJECT_ID == Project.ID)
            .filter(WorkOrder.PROJECT_ID.in_(project_ids))
            .order_by(WorkOrder.CREATED_AT.desc())
            .all()
        )

    # ---- Group machine models being / have been built for them ----
    by_model = {}

    for wo, model, _ in work_orders:

        if not model:

            continue

        key = model.ID

        if key not in by_model:

            by_model[key] = {
                "MODEL_ID": model.ID,
                "MODEL_CODE": model.MODEL_CODE,
                "MODEL_NAME": model.MODEL_NAME,
                "CATEGORY": model.CATEGORY,
                "total_units": 0,
                "wo_count": 0,
                "in_progress_units": 0,
                "done_units": 0
            }

        by_model[key]["total_units"] += wo.QUANTITY or 0

        by_model[key]["wo_count"] += 1

        if wo.STATUS == "IN_PROGRESS":

            by_model[key]["in_progress_units"] += wo.QUANTITY or 0

        elif wo.STATUS == "DONE":

            by_model[key]["done_units"] += wo.QUANTITY or 0

    # ---- BOM details for each model the customer is buying ----
    bom_by_model = {}

    for model_id in by_model.keys():

        bom = (
            db.query(BOMItem)
            .filter(BOMItem.PRODUCT_MODEL_ID == model_id)
            .order_by(BOMItem.ID)
            .all()
        )

        bom_by_model[model_id] = [
            {
                "MATERIAL_NAME": b.MATERIAL_NAME,
                "QUANTITY": b.QUANTITY,
                "UNIT": b.UNIT,
                "TYPE": b.ITEM_TYPE or "PURCHASE"
            }
            for b in bom
        ]

    # ---- Summary numbers ----
    total_units_ordered = sum(
        (wo.QUANTITY or 0) for wo, _, _ in work_orders
    )

    units_in_progress = sum(
        (wo.QUANTITY or 0) for wo, _, _ in work_orders
        if wo.STATUS == "IN_PROGRESS"
    )

    units_delivered = sum(
        (wo.QUANTITY or 0) for wo, _, _ in work_orders
        if wo.STATUS == "DONE"
    )

    active_projects = sum(
        1 for p, _ in projects
        if p.STATUS in ("PENDING", "IN_PROGRESS", "ACTIVE")
    )

    return {
        "customer": {
            "ID": customer.ID,
            "CUSTOMER_CODE": customer.CUSTOMER_CODE,
            "CUSTOMER_NAME": customer.CUSTOMER_NAME,
            "CONTACT_PERSON": customer.CONTACT_PERSON,
            "DESIGNATION": customer.DESIGNATION,
            "PHONE": customer.PHONE,
            "ALTERNATE_PHONE": customer.ALTERNATE_PHONE,
            "EMAIL": customer.EMAIL,
            "WEBSITE": customer.WEBSITE,
            "ADDRESS": customer.ADDRESS,
            "CITY": customer.CITY,
            "STATE": customer.STATE,
            "PINCODE": customer.PINCODE,
            "COUNTRY": customer.COUNTRY,
            "GST_NUMBER": customer.GST_NUMBER,
            "PAN_NUMBER": customer.PAN_NUMBER,
            "INDUSTRY": customer.INDUSTRY,
            "SOURCE": customer.SOURCE,
            "STATUS": customer.STATUS,
            "NOTES": customer.NOTES,
            "CREATED_AT": _iso(customer.CREATED_AT)
        },
        "summary": {
            "projects_total": len(projects),
            "active_projects": active_projects,
            "work_orders_total": len(work_orders),
            "machine_models_count": len(by_model),
            "total_units_ordered": int(total_units_ordered),
            "units_in_progress": int(units_in_progress),
            "units_delivered": int(units_delivered)
        },
        "projects": [
            {
                "ID": p.ID,
                "PROJECT_NAME": p.PROJECT_NAME,
                "DESCRIPTION": p.DESCRIPTION,
                "STATUS": p.STATUS,
                "PRIORITY": p.PRIORITY,
                "DEPARTMENT": d.NAME if d else None
            }
            for p, d in projects
        ],
        "work_orders": [
            {
                "ID": wo.ID,
                "WO_NUMBER": wo.WO_NUMBER,
                "PROJECT_ID": wo.PROJECT_ID,
                "PROJECT_NAME": project.PROJECT_NAME if project else None,
                "MODEL_ID": model.ID if model else None,
                "MODEL_NAME": model.MODEL_NAME if model else None,
                "MODEL_CODE": model.MODEL_CODE if model else None,
                "QUANTITY": wo.QUANTITY,
                "STATUS": wo.STATUS,
                "PLANNED_START_DATE": _iso(wo.PLANNED_START_DATE),
                "PLANNED_END_DATE": _iso(wo.PLANNED_END_DATE)
            }
            for wo, model, project in work_orders
        ],
        "machine_models": [
            {
                **m,
                "bom_preview": (
                    bom_by_model.get(m["MODEL_ID"], [])[:6]
                ),
                "bom_total_items": len(
                    bom_by_model.get(m["MODEL_ID"], [])
                )
            }
            for m in by_model.values()
        ]
    }


# ================================================================
# WORK ORDER 360°
# ================================================================

@router.get("/work-order/{wo_id}/360")
def work_order_360(wo_id: int, db: Session = Depends(get_db)):

    row = (
        db.query(WorkOrder, ProductModel, Project)
        .outerjoin(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .outerjoin(Project, WorkOrder.PROJECT_ID == Project.ID)
        .filter(WorkOrder.ID == wo_id)
        .first()
    )

    if not row:

        raise HTTPException(status_code=404, detail="Work order not found")

    wo, model, project = row

    # ---- BOM rolled up by quantity ----
    bom = (
        db.query(BOMItem, Supplier, ProcessStage)
        .outerjoin(
            Supplier,
            BOMItem.PREFERRED_SUPPLIER_ID == Supplier.ID
        )
        .outerjoin(
            ProcessStage,
            BOMItem.PROCESS_STAGE_ID == ProcessStage.ID
        )
        .filter(BOMItem.PRODUCT_MODEL_ID == wo.PRODUCT_MODEL_ID)
        .all()
        if wo.PRODUCT_MODEL_ID else []
    )

    # ---- Stage progress for this WO ----
    stages = (
        db.query(WorkOrderStageProgress, ProcessStage, Employee)
        .join(
            ProcessStage,
            WorkOrderStageProgress.STAGE_ID == ProcessStage.ID
        )
        .outerjoin(
            Employee,
            WorkOrderStageProgress.ASSIGNED_TO_ID == Employee.ID
        )
        .filter(WorkOrderStageProgress.WORK_ORDER_ID == wo.ID)
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    # ---- Inspections + NCRs ----
    inspections = (
        db.query(QCInspection)
        .filter(QCInspection.WORK_ORDER_ID == wo.ID)
        .order_by(QCInspection.CREATED_AT.desc())
        .all()
    )

    ncrs = (
        db.query(NCR)
        .filter(NCR.WORK_ORDER_ID == wo.ID)
        .order_by(NCR.OPENED_AT.desc())
        .all()
    )

    return {
        "work_order": {
            "ID": wo.ID,
            "WO_NUMBER": wo.WO_NUMBER,
            "QUANTITY": wo.QUANTITY,
            "STATUS": wo.STATUS,
            "PLANNED_START_DATE": _iso(wo.PLANNED_START_DATE),
            "PLANNED_END_DATE": _iso(wo.PLANNED_END_DATE),
            "ACTUAL_START_DATE": _iso(wo.ACTUAL_START_DATE),
            "ACTUAL_END_DATE": _iso(wo.ACTUAL_END_DATE),
            "NOTES": wo.NOTES
        },
        "machine_model": (
            {
                "ID": model.ID,
                "MODEL_CODE": model.MODEL_CODE,
                "MODEL_NAME": model.MODEL_NAME,
                "CATEGORY": model.CATEGORY,
                "ESTIMATED_BUILD_DAYS": model.ESTIMATED_BUILD_DAYS
            }
            if model else None
        ),
        "project": (
            {
                "ID": project.ID,
                "PROJECT_NAME": project.PROJECT_NAME,
                "STATUS": project.STATUS
            }
            if project else None
        ),
        "bom": [
            {
                "ID": b.ID,
                "MATERIAL_NAME": b.MATERIAL_NAME,
                "PER_UNIT": b.QUANTITY,
                "TOTAL_FOR_WO": round((b.QUANTITY or 0) * wo.QUANTITY, 3),
                "UNIT": b.UNIT,
                "TYPE": b.ITEM_TYPE or "PURCHASE",
                "SUPPLIER_ID": sup.ID if sup else None,
                "SUPPLIER_NAME": sup.COMPANY_NAME if sup else None,
                "STAGE_NAME": stage.STAGE_NAME if stage else None
            }
            for b, sup, stage in bom
        ],
        "stages": [
            {
                "STAGE_ID": stage.ID,
                "SEQUENCE": stage.SEQUENCE,
                "STAGE_NAME": stage.STAGE_NAME,
                "STAGE_TYPE": stage.STAGE_TYPE,
                "STATUS": progress.STATUS,
                "ASSIGNED_TO_ID": progress.ASSIGNED_TO_ID,
                "ASSIGNED_TO_NAME": emp.NAME if emp else None,
                "STARTED_AT": _iso(progress.STARTED_AT),
                "COMPLETED_AT": _iso(progress.COMPLETED_AT),
                "NOTES": progress.NOTES
            }
            for progress, stage, emp in stages
        ],
        "inspections": [
            {
                "ID": i.ID,
                "STATUS": i.STATUS,
                "PASS_COUNT": i.PASS_COUNT,
                "FAIL_COUNT": i.FAIL_COUNT,
                "REWORK_COUNT": i.REWORK_COUNT,
                "INSPECTION_DATE": _iso(i.INSPECTION_DATE)
            }
            for i in inspections
        ],
        "ncrs": [
            {
                "ID": n.ID,
                "NCR_NUMBER": n.NCR_NUMBER,
                "CHECK_POINT": n.CHECK_POINT,
                "SEVERITY": n.SEVERITY,
                "STATUS": n.STATUS,
                "OPENED_AT": _iso(n.OPENED_AT)
            }
            for n in ncrs
        ]
    }


# ================================================================
# SUPPLIER 360°
# ================================================================

@router.get("/supplier/{supplier_id}/360")
def supplier_360(supplier_id: int, db: Session = Depends(get_db)):

    sup = db.query(Supplier).filter(Supplier.ID == supplier_id).first()

    if not sup:

        raise HTTPException(status_code=404, detail="Supplier not found")

    # ---- BOM lines using this supplier (which parts in which models) ----
    bom_links = (
        db.query(BOMItem, ProductModel)
        .outerjoin(
            ProductModel,
            BOMItem.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .filter(BOMItem.PREFERRED_SUPPLIER_ID == sup.ID)
        .all()
    )

    # Group BOM lines by model
    by_model = {}

    for b, m in bom_links:

        if not m:

            continue

        key = m.ID

        if key not in by_model:

            by_model[key] = {
                "MODEL_ID": m.ID,
                "MODEL_CODE": m.MODEL_CODE,
                "MODEL_NAME": m.MODEL_NAME,
                "parts": []
            }

        by_model[key]["parts"].append({
            "MATERIAL_NAME": b.MATERIAL_NAME,
            "QUANTITY": b.QUANTITY,
            "UNIT": b.UNIT
        })

    # ---- Active WOs that need parts from this supplier ----
    active_wos = (
        db.query(WorkOrder, ProductModel)
        .join(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .filter(
            WorkOrder.STATUS.in_(["PLANNED", "IN_PROGRESS"]),
            ProductModel.ID.in_(by_model.keys()) if by_model else False
        )
        .all()
    ) if by_model else []

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
        },
        "models_supplied": list(by_model.values()),
        "active_work_orders_needing_supplier": [
            {
                "WO_ID": wo.ID,
                "WO_NUMBER": wo.WO_NUMBER,
                "MODEL_NAME": m.MODEL_NAME,
                "QUANTITY": wo.QUANTITY,
                "STATUS": wo.STATUS
            }
            for wo, m in active_wos
        ],
        "summary": {
            "models_count": len(by_model),
            "active_wos_count": len(active_wos),
            "total_bom_lines": len(bom_links)
        }
    }


# ================================================================
# WORKFLOW SNAPSHOT — live counts at every step of BVC24 flow
# ================================================================

@router.get("/workflow/snapshot")
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

        "products": {
            "machine_models": db.query(ProductModel).count(),
            "bom_lines": db.query(BOMItem).count(),
            "process_stages_defined": db.query(ProcessStage).filter(
                ProcessStage.IS_ACTIVE == 1
            ).count()
        },

        "sales": {
            "projects_total": db.query(Project).count(),
            "projects_active": db.query(Project).filter(
                Project.STATUS.in_(["PENDING", "IN_PROGRESS", "ACTIVE"])
            ).count()
        },

        "production": {
            "work_orders_total": db.query(WorkOrder).count(),
            "work_orders_in_progress": db.query(WorkOrder).filter(
                WorkOrder.STATUS == "IN_PROGRESS"
            ).count(),
            "work_orders_done": db.query(WorkOrder).filter(
                WorkOrder.STATUS == "DONE"
            ).count(),
            "units_in_pipeline": int(
                db.query(func.coalesce(func.sum(WorkOrder.QUANTITY), 0))
                .filter(WorkOrder.STATUS == "IN_PROGRESS")
                .scalar() or 0
            ),
            "stage_progress_rows": db.query(WorkOrderStageProgress).count(),
            "stages_done_today": db.query(WorkOrderStageProgress).filter(
                WorkOrderStageProgress.STATUS == "DONE",
                func.date(WorkOrderStageProgress.COMPLETED_AT) == today
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

        "quality": {
            "inspections_total": db.query(QCInspection).count(),
            "inspections_pass": db.query(QCInspection).filter(
                QCInspection.STATUS == "PASS"
            ).count(),
            "inspections_fail": db.query(QCInspection).filter(
                QCInspection.STATUS == "FAIL"
            ).count(),
            "open_ncrs": db.query(NCR).filter(
                NCR.STATUS.in_(["OPEN", "IN_PROGRESS"])
            ).count(),
            "critical_open_ncrs": db.query(NCR).filter(
                NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]),
                NCR.SEVERITY == "CRITICAL"
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
