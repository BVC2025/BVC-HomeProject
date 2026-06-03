"""
Google Gemini chatbot — hybrid layer.

When the rule-based bot can't match a query, Gemini takes over.
Gemini doesn't have direct DB access; instead it picks from a
fixed catalog of TOOLS (function declarations). Each tool wraps
a SQL query and returns JSON. Gemini reads the result and turns
it into a natural-language reply.

This keeps responses grounded — Gemini can NEVER hallucinate
data because every fact has to come from a tool call.

Free tier:
  Gemini 2.0 Flash — 1500 req/day, 15 RPM, 1M tokens/min.
  Get a free API key at https://aistudio.google.com/apikey
  Set GEMINI_API_KEY in backend/.env
"""

import os
from datetime import date, datetime, timedelta
from typing import Optional, Any, Dict, List

from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.models.models import (
    Employee,
    Role,
    Department,
    TaskAssignment,
    Project,
    Inventory,
    Machine,
    Attendance,
    Customer,
    Supplier,
    ProductModel,
    BOMItem,
    WorkOrder,
    ProcessStage,
    WorkOrderStageProgress,
    QCInspection,
    NCR,
    LeaveRequest,
    LeaveBalance,
    BiometricEvent,
    Vendor
)


# ----------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------

GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()

# Google has retired several preview/legacy Gemini models on
# v1beta:
#   - gemini-2.0-flash-exp  -> use gemini-2.0-flash (no -exp)
#   - gemini-1.5-flash      -> deprecated entirely (Nov 2025)
#
# Current free-tier models (Nov 2025), tried in order:
#   1. Whatever the user sets in GEMINI_MODEL (.env override)
#   2. gemini-2.5-flash         (best free, default)
#   3. gemini-2.5-flash-lite    (faster, cheaper)
#   4. gemini-2.0-flash         (stable)
#   5. gemini-flash-latest      (rolling alias Google maintains)

GEMINI_MODEL_FALLBACKS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-flash-latest"
]

_user_model = (os.getenv("GEMINI_MODEL", "") or "").strip()

if _user_model:

    # Push user's choice to the front, dedupe the rest
    GEMINI_MODEL_FALLBACKS = (
        [_user_model]
        + [m for m in GEMINI_MODEL_FALLBACKS if m != _user_model]
    )

GEMINI_MODEL = GEMINI_MODEL_FALLBACKS[0]


def is_gemini_configured() -> bool:

    return bool(GEMINI_API_KEY)


# ----------------------------------------------------------------
# System prompt — establishes BVC24 persona
# ----------------------------------------------------------------

SYSTEM_INSTRUCTION = """
You are the AI assistant for BVC24 (Bharath Vending Corporation),
a Coimbatore-based vending machine manufacturer. You help the
admin, MD and floor staff understand what's happening across
their AI-driven smart manufacturing ERP.

Behavioural rules:
  - Be concise and concrete. Prefer short paragraphs + bullet
    lists over long prose.
  - Always answer in English. The user may write in Tanglish
    (Tamil + English) — understand it and reply in English.
  - When a question needs real data, ALWAYS call a tool. Never
    invent numbers, names, or status values. If no tool fits,
    say so honestly.
  - For workforce, production, quality, leave and performance
    questions, prefer tools over guesses.
  - Add a short follow-up suggestion at the end when relevant.
  - Time zone: Asia/Kolkata. Today's date is provided in the
    system context.
""".strip()


# ----------------------------------------------------------------
# Tool implementations — pure Python, return JSON-serializable data
# ----------------------------------------------------------------

def _serialize_employee(e: Employee, dept_name: Optional[str] = None) -> Dict:

    return {
        "code": e.EMPLOYEE_CODE,
        "name": e.NAME,
        "email": e.EMAIL,
        "department": dept_name,
        "skills": e.SKILLS,
        "fingerprint_id": e.FINGERPRINT_ID,
        "status": e.STATUS
    }


def tool_bvc24_overview(db: Session, **_) -> Dict:

    today = date.today()

    employees = db.query(Employee).filter(Employee.STATUS == "ACTIVE").count()

    in_office = (
        db.query(Attendance)
        .filter(
            Attendance.DATE == today,
            Attendance.CHECK_IN.isnot(None),
            Attendance.CHECK_OUT.is_(None)
        )
        .count()
    )

    pending_leaves = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.STATUS == "PENDING_APPROVAL")
        .count()
    )

    wo_in_progress = (
        db.query(WorkOrder).filter(WorkOrder.STATUS == "IN_PROGRESS").count()
    )

    units_in_progress = (
        db.query(func.coalesce(func.sum(WorkOrder.QUANTITY), 0))
        .filter(WorkOrder.STATUS == "IN_PROGRESS")
        .scalar()
        or 0
    )

    open_ncrs = (
        db.query(NCR)
        .filter(NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]))
        .count()
    )

    critical_ncrs = (
        db.query(NCR)
        .filter(
            NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]),
            NCR.SEVERITY == "CRITICAL"
        )
        .count()
    )

    suppliers = (
        db.query(Supplier).filter(Supplier.STATUS == "ACTIVE").count()
    )

    return {
        "active_employees": employees,
        "in_office_now": in_office,
        "pending_leave_requests": pending_leaves,
        "work_orders_in_progress": wo_in_progress,
        "units_in_progress": int(units_in_progress),
        "open_ncrs": open_ncrs,
        "critical_ncrs": critical_ncrs,
        "active_suppliers": suppliers
    }


def tool_production_status(db: Session, **_) -> Dict:

    by_status = {}

    for s in ["PLANNED", "IN_PROGRESS", "ON_HOLD", "DONE", "CANCELLED"]:

        by_status[s] = (
            db.query(WorkOrder).filter(WorkOrder.STATUS == s).count()
        )

    units = (
        db.query(func.coalesce(func.sum(WorkOrder.QUANTITY), 0))
        .filter(WorkOrder.STATUS == "IN_PROGRESS")
        .scalar()
        or 0
    )

    return {
        "total_work_orders": sum(by_status.values()),
        "by_status": by_status,
        "units_currently_in_production": int(units)
    }


def tool_list_work_orders(
    db: Session,
    status: Optional[str] = None,
    limit: int = 10,
    **_
) -> List[Dict]:

    q = (
        db.query(WorkOrder, ProductModel)
        .outerjoin(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
    )

    if status:

        q = q.filter(WorkOrder.STATUS == status.upper())

    rows = q.order_by(WorkOrder.CREATED_AT.desc()).limit(limit).all()

    return [
        {
            "wo_number": wo.WO_NUMBER,
            "model": model.MODEL_NAME if model else None,
            "model_code": model.MODEL_CODE if model else None,
            "quantity": wo.QUANTITY,
            "status": wo.STATUS,
            "notes": wo.NOTES
        }
        for wo, model in rows
    ]


def tool_list_machine_models(db: Session, **_) -> List[Dict]:

    rows = db.query(ProductModel).order_by(ProductModel.MODEL_NAME).all()

    return [
        {
            "model_code": m.MODEL_CODE,
            "name": m.MODEL_NAME,
            "category": m.CATEGORY,
            "build_days": m.ESTIMATED_BUILD_DAYS,
            "description": m.DESCRIPTION,
            "status": m.STATUS
        }
        for m in rows
    ]


def tool_get_bom_for_model(
    db: Session,
    model_code_or_name: str,
    **_
) -> Dict:

    needle = (model_code_or_name or "").strip().lower()

    if not needle:

        return {"error": "model_code_or_name is required"}

    model = (
        db.query(ProductModel)
        .filter(
            or_(
                ProductModel.MODEL_CODE.ilike(f"%{needle}%"),
                ProductModel.MODEL_NAME.ilike(f"%{needle}%")
            )
        )
        .first()
    )

    if not model:

        return {"error": f"No model matched '{model_code_or_name}'"}

    bom = (
        db.query(BOMItem)
        .filter(BOMItem.PRODUCT_MODEL_ID == model.ID)
        .order_by(BOMItem.ID)
        .all()
    )

    return {
        "model_code": model.MODEL_CODE,
        "model_name": model.MODEL_NAME,
        "category": model.CATEGORY,
        "bom_items": [
            {
                "material": b.MATERIAL_NAME,
                "quantity": b.QUANTITY,
                "unit": b.UNIT or "pcs",
                "type": b.ITEM_TYPE or "PURCHASE"
            }
            for b in bom
        ]
    }


def tool_get_stages_for_model(
    db: Session,
    model_code_or_name: str,
    **_
) -> Dict:

    needle = (model_code_or_name or "").strip().lower()

    model = (
        db.query(ProductModel)
        .filter(
            or_(
                ProductModel.MODEL_CODE.ilike(f"%{needle}%"),
                ProductModel.MODEL_NAME.ilike(f"%{needle}%")
            )
        )
        .first()
    )

    if not model:

        return {"error": f"No model matched '{model_code_or_name}'"}

    stages = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == model.ID,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    return {
        "model_code": model.MODEL_CODE,
        "model_name": model.MODEL_NAME,
        "stages": [
            {
                "sequence": s.SEQUENCE,
                "name": s.STAGE_NAME,
                "type": s.STAGE_TYPE,
                "estimated_hours": s.ESTIMATED_HOURS,
                "description": s.DESCRIPTION
            }
            for s in stages
        ]
    }


def tool_quality_status(db: Session, **_) -> Dict:

    by_status = {}

    for s in ["PENDING", "PASS", "FAIL", "REWORK"]:

        by_status[s] = (
            db.query(QCInspection).filter(QCInspection.STATUS == s).count()
        )

    total = sum(by_status.values())

    pass_rate = (
        round(by_status["PASS"] / total * 100, 1) if total else 0
    )

    open_ncrs = (
        db.query(NCR)
        .filter(NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]))
        .count()
    )

    critical = (
        db.query(NCR)
        .filter(
            NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]),
            NCR.SEVERITY == "CRITICAL"
        )
        .count()
    )

    return {
        "total_inspections": total,
        "by_status": by_status,
        "pass_rate_pct": pass_rate,
        "open_ncrs": open_ncrs,
        "critical_open_ncrs": critical
    }


def tool_list_ncrs(
    db: Session,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
    **_
) -> List[Dict]:

    q = db.query(NCR)

    if severity:

        q = q.filter(NCR.SEVERITY == severity.upper())

    if status:

        q = q.filter(NCR.STATUS == status.upper())

    else:

        # Default to open ones
        q = q.filter(NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]))

    rows = q.order_by(NCR.OPENED_AT.desc()).limit(limit).all()

    return [
        {
            "ncr_number": n.NCR_NUMBER,
            "check_point": n.CHECK_POINT,
            "severity": n.SEVERITY,
            "status": n.STATUS,
            "description": n.DESCRIPTION,
            "opened_at": n.OPENED_AT.isoformat() if n.OPENED_AT else None
        }
        for n in rows
    ]


def tool_list_suppliers(
    db: Session,
    category: Optional[str] = None,
    limit: int = 20,
    **_
) -> List[Dict]:

    q = db.query(Supplier).filter(Supplier.STATUS == "ACTIVE")

    if category:

        q = q.filter(Supplier.CATEGORY.ilike(f"%{category}%"))

    rows = q.order_by(Supplier.COMPANY_NAME).limit(limit).all()

    return [
        {
            "code": s.SUPPLIER_CODE,
            "company": s.COMPANY_NAME,
            "contact": s.CONTACT_PERSON,
            "city": s.CITY,
            "state": s.STATE,
            "gst": s.GST_NUMBER,
            "category": s.CATEGORY,
            "payment_terms": s.PAYMENT_TERMS,
            "phone": s.PHONE,
            "email": s.EMAIL
        }
        for s in rows
    ]


def tool_leave_summary(db: Session, **_) -> Dict:

    by_status = {}

    for s in ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"]:

        by_status[s] = (
            db.query(LeaveRequest).filter(LeaveRequest.STATUS == s).count()
        )

    today = date.today()

    on_leave_today = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE <= today,
            LeaveRequest.END_DATE >= today
        )
        .count()
    )

    return {
        "by_status": by_status,
        "on_leave_today": on_leave_today,
        "total": sum(by_status.values())
    }


def tool_list_pending_leaves(db: Session, limit: int = 15, **_) -> List[Dict]:

    rows = (
        db.query(LeaveRequest, Employee)
        .outerjoin(Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID)
        .filter(LeaveRequest.STATUS == "PENDING_APPROVAL")
        .order_by(LeaveRequest.CREATED_AT.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "employee_name": emp.NAME if emp else None,
            "employee_code": emp.EMPLOYEE_CODE if emp else None,
            "type": lv.LEAVE_TYPE,
            "from": lv.START_DATE.isoformat() if lv.START_DATE else None,
            "to": lv.END_DATE.isoformat() if lv.END_DATE else None,
            "days": lv.DAYS,
            "reason": lv.REASON
        }
        for lv, emp in rows
    ]


def tool_employee_leave_balance(
    db: Session,
    employee_code_or_name: str,
    **_
) -> Dict:

    needle = (employee_code_or_name or "").strip()

    emp = (
        db.query(Employee)
        .filter(
            or_(
                Employee.EMPLOYEE_CODE.ilike(needle),
                Employee.NAME.ilike(f"%{needle}%")
            )
        )
        .first()
    )

    if not emp:

        return {"error": f"No employee matched '{employee_code_or_name}'"}

    year = date.today().year

    bal = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.EMPLOYEE_ID == emp.ID,
            LeaveBalance.YEAR == year
        )
        .first()
    )

    if not bal:

        return {
            "employee": emp.NAME,
            "year": year,
            "balance_not_initialised": True
        }

    return {
        "employee": emp.NAME,
        "employee_code": emp.EMPLOYEE_CODE,
        "year": year,
        "casual": {
            "total": bal.CASUAL_TOTAL,
            "used": bal.CASUAL_USED,
            "remaining": round(bal.CASUAL_TOTAL - bal.CASUAL_USED, 1)
        },
        "sick": {
            "total": bal.SICK_TOTAL,
            "used": bal.SICK_USED,
            "remaining": round(bal.SICK_TOTAL - bal.SICK_USED, 1)
        },
        "earned": {
            "total": bal.EARNED_TOTAL,
            "used": bal.EARNED_USED,
            "remaining": round(bal.EARNED_TOTAL - bal.EARNED_USED, 1)
        }
    }


def tool_who_is_in_office(db: Session, **_) -> List[Dict]:

    today = date.today()

    rows = (
        db.query(Attendance, Employee)
        .outerjoin(Employee, Attendance.EMPLOYEE_ID == Employee.ID)
        .filter(
            Attendance.DATE == today,
            Attendance.CHECK_IN.isnot(None),
            Attendance.CHECK_OUT.is_(None)
        )
        .all()
    )

    return [
        {
            "name": emp.NAME if emp else None,
            "code": emp.EMPLOYEE_CODE if emp else None,
            "check_in": att.CHECK_IN.isoformat() if att.CHECK_IN else None,
            "status": att.STATUS
        }
        for att, emp in rows
    ]


def tool_recent_biometric_scans(
    db: Session,
    limit: int = 10,
    **_
) -> List[Dict]:

    rows = (
        db.query(BiometricEvent, Employee)
        .outerjoin(Employee, BiometricEvent.EMPLOYEE_ID == Employee.ID)
        .order_by(BiometricEvent.EVENT_TIME.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "employee_name": emp.NAME if emp else None,
            "employee_code": emp.EMPLOYEE_CODE if emp else None,
            "fingerprint_id": evt.FINGERPRINT_ID,
            "device": evt.DEVICE_ID,
            "time": evt.EVENT_TIME.isoformat() if evt.EVENT_TIME else None,
            "result": evt.RESULT
        }
        for evt, emp in rows
    ]


def tool_find_employee(
    db: Session,
    name_or_code: str,
    **_
) -> Dict:

    needle = (name_or_code or "").strip()

    if not needle:

        return {"error": "name_or_code is required"}

    emp = (
        db.query(Employee, Department)
        .outerjoin(Department, Employee.DEPARTMENT_ID == Department.ID)
        .filter(
            or_(
                Employee.EMPLOYEE_CODE.ilike(needle),
                Employee.NAME.ilike(f"%{needle}%"),
                Employee.EMAIL.ilike(f"%{needle}%")
            )
        )
        .first()
    )

    if not emp:

        return {"error": f"No employee matched '{name_or_code}'"}

    e, dept = emp

    active_tasks = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == e.ID,
            TaskAssignment.TASK_STATUS.in_(
                ["PENDING", "IN_PROGRESS", "ON_HOLD"]
            )
        )
        .count()
    )

    completed_today = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == e.ID,
            TaskAssignment.ASSIGNED_DATE == date.today(),
            TaskAssignment.TASK_STATUS.in_(["DONE", "COMPLETED"])
        )
        .count()
    )

    return {
        **_serialize_employee(e, dept.NAME if dept else None),
        "active_tasks": active_tasks,
        "tasks_completed_today": completed_today,
        "joining_date": (
            e.JOINING_DATE.isoformat() if e.JOINING_DATE else None
        )
    }


def tool_list_employees(
    db: Session,
    department: Optional[str] = None,
    skill: Optional[str] = None,
    limit: int = 30,
    **_
) -> List[Dict]:

    q = (
        db.query(Employee, Department)
        .outerjoin(Department, Employee.DEPARTMENT_ID == Department.ID)
        .filter(Employee.STATUS == "ACTIVE")
    )

    if department:

        q = q.filter(
            or_(
                Department.NAME.ilike(f"%{department}%"),
                Department.CODE.ilike(f"%{department}%")
            )
        )

    if skill:

        q = q.filter(Employee.SKILLS.ilike(f"%{skill}%"))

    rows = q.order_by(Employee.NAME).limit(limit).all()

    return [
        _serialize_employee(e, d.NAME if d else None) for e, d in rows
    ]


def tool_performance_summary(db: Session, days: int = 30, **_) -> Dict:

    from app.services.performance_service import score_all_employees

    today = date.today()

    start = today - timedelta(days=days - 1)

    bvc = (
        db.query(Vendor)
        .filter(Vendor.VENDOR_NAME == "Bharath Vending Corporation")
        .first()
    )

    vendor_id = bvc.ID if bvc else 1

    rows = score_all_employees(db, vendor_id, start, today)

    if not rows:

        return {"period_days": days, "employees": [], "note": "No data."}

    return {
        "period_days": days,
        "average_score": round(
            sum(r["performance_score"] for r in rows) / len(rows), 1
        ),
        "top": {
            "name": rows[0]["NAME"],
            "score": rows[0]["performance_score"],
            "band": rows[0]["band"],
            "suggested_increment_pct": rows[0]["suggested_increment_pct"]
        },
        "bottom": {
            "name": rows[-1]["NAME"],
            "score": rows[-1]["performance_score"],
            "band": rows[-1]["band"],
            "suggested_increment_pct": rows[-1]["suggested_increment_pct"]
        },
        "all": [
            {
                "name": r["NAME"],
                "code": r["EMPLOYEE_CODE"],
                "score": r["performance_score"],
                "band": r["band"],
                "suggested_increment_pct": r["suggested_increment_pct"]
            }
            for r in rows
        ]
    }


def tool_inventory_status(db: Session, low_threshold: int = 10, **_) -> Dict:

    rows = db.query(Inventory).all()

    total_items = len(rows)

    low_stock = [r for r in rows if (r.QUANTITY or 0) < low_threshold]

    out_of_stock = [r for r in rows if (r.QUANTITY or 0) == 0]

    total_value = sum(
        (r.QUANTITY or 0) * (r.UNIT_PRICE or 0) for r in rows
    )

    return {
        "total_distinct_items": total_items,
        "low_stock_count": len(low_stock),
        "out_of_stock_count": len(out_of_stock),
        "total_inventory_value": round(total_value, 2),
        "low_stock_items": [
            {
                "material": r.MATERIAL_NAME,
                "quantity": r.QUANTITY,
                "unit_price": r.UNIT_PRICE
            }
            for r in low_stock[:10]
        ]
    }


def tool_pending_tasks(
    db: Session,
    employee_code: Optional[str] = None,
    limit: int = 20,
    **_
) -> List[Dict]:

    q = (
        db.query(TaskAssignment, Employee, Project)
        .outerjoin(Employee, TaskAssignment.EMPLOYEE_ID == Employee.ID)
        .outerjoin(Project, TaskAssignment.PROJECT_ID == Project.ID)
        .filter(TaskAssignment.TASK_STATUS.in_(["PENDING", "IN_PROGRESS"]))
    )

    if employee_code:

        q = q.filter(Employee.EMPLOYEE_CODE.ilike(employee_code))

    rows = q.order_by(TaskAssignment.ASSIGNED_DATE.desc()).limit(limit).all()

    return [
        {
            "task_name": t.TASK_NAME,
            "employee": emp.NAME if emp else None,
            "employee_code": emp.EMPLOYEE_CODE if emp else None,
            "project": proj.PROJECT_NAME if proj else None,
            "status": t.TASK_STATUS,
            "assigned_date": (
                t.ASSIGNED_DATE.isoformat() if t.ASSIGNED_DATE else None
            ),
            "due_date": t.DUE_DATE.isoformat() if t.DUE_DATE else None
        }
        for t, emp, proj in rows
    ]


# ----------------------------------------------------------------
# Tool registry — name → (function, declaration)
# ----------------------------------------------------------------

TOOL_REGISTRY = {
    "bvc24_overview": {
        "fn": tool_bvc24_overview,
        "decl": {
            "name": "bvc24_overview",
            "description": (
                "Get a system-wide snapshot of BVC24: active employees, "
                "in-office count, pending leave requests, work orders "
                "in progress, open NCRs, active suppliers. Use for "
                "general 'how are things' questions."
            ),
            "parameters": {"type": "object", "properties": {}}
        }
    },
    "production_status": {
        "fn": tool_production_status,
        "decl": {
            "name": "production_status",
            "description": (
                "Production summary: total work orders, count by "
                "status (PLANNED/IN_PROGRESS/ON_HOLD/DONE), units "
                "currently being manufactured."
            ),
            "parameters": {"type": "object", "properties": {}}
        }
    },
    "list_work_orders": {
        "fn": tool_list_work_orders,
        "decl": {
            "name": "list_work_orders",
            "description": (
                "List recent work orders. Optionally filter by status "
                "(PLANNED, IN_PROGRESS, DONE, etc.)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "Optional status filter"
                    },
                    "limit": {"type": "integer"}
                }
            }
        }
    },
    "list_machine_models": {
        "fn": tool_list_machine_models,
        "decl": {
            "name": "list_machine_models",
            "description": (
                "List all vending machine models BVC24 manufactures "
                "(Snack Combo, Medicine Dispenser, Hot Food Box, "
                "Cosmetics Kiosk, Fruits & Veg)."
            ),
            "parameters": {"type": "object", "properties": {}}
        }
    },
    "get_bom_for_model": {
        "fn": tool_get_bom_for_model,
        "decl": {
            "name": "get_bom_for_model",
            "description": (
                "Bill of Materials (BOM) for a specific machine model. "
                "Pass the model code (e.g. BVC-SBC-01) or its name "
                "(e.g. 'Snack Combo'). Returns parts list with "
                "quantities and PURCHASE/PROCESS classification."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "model_code_or_name": {"type": "string"}
                },
                "required": ["model_code_or_name"]
            }
        }
    },
    "get_stages_for_model": {
        "fn": tool_get_stages_for_model,
        "decl": {
            "name": "get_stages_for_model",
            "description": (
                "Manufacturing process stages for a machine model "
                "(Design → Mechanical → Electrical → ... → Packaging)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "model_code_or_name": {"type": "string"}
                },
                "required": ["model_code_or_name"]
            }
        }
    },
    "quality_status": {
        "fn": tool_quality_status,
        "decl": {
            "name": "quality_status",
            "description": (
                "QC overview: inspection counts by status, pass rate %, "
                "open NCRs, critical NCR count."
            ),
            "parameters": {"type": "object", "properties": {}}
        }
    },
    "list_ncrs": {
        "fn": tool_list_ncrs,
        "decl": {
            "name": "list_ncrs",
            "description": (
                "List Non-Conformance Reports. Optionally filter by "
                "severity (CRITICAL/MAJOR/MINOR) and status "
                "(OPEN/IN_PROGRESS/CLOSED)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string"},
                    "status": {"type": "string"},
                    "limit": {"type": "integer"}
                }
            }
        }
    },
    "list_suppliers": {
        "fn": tool_list_suppliers,
        "decl": {
            "name": "list_suppliers",
            "description": (
                "List active suppliers. Optionally filter by category "
                "(Motors, Electronics, Display, Payment Hardware, "
                "Refrigeration, Sheet Metal, Glass)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "limit": {"type": "integer"}
                }
            }
        }
    },
    "leave_summary": {
        "fn": tool_leave_summary,
        "decl": {
            "name": "leave_summary",
            "description": (
                "Leave overview: counts by status, on-leave-today total."
            ),
            "parameters": {"type": "object", "properties": {}}
        }
    },
    "list_pending_leaves": {
        "fn": tool_list_pending_leaves,
        "decl": {
            "name": "list_pending_leaves",
            "description": (
                "List leave requests awaiting MD approval with employee, "
                "type, dates, days, and reason."
            ),
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer"}}
            }
        }
    },
    "employee_leave_balance": {
        "fn": tool_employee_leave_balance,
        "decl": {
            "name": "employee_leave_balance",
            "description": (
                "Get an employee's remaining leave balance "
                "(casual / sick / earned) for the current year. "
                "Pass employee code (BVC001) or name."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "employee_code_or_name": {"type": "string"}
                },
                "required": ["employee_code_or_name"]
            }
        }
    },
    "who_is_in_office": {
        "fn": tool_who_is_in_office,
        "decl": {
            "name": "who_is_in_office",
            "description": (
                "Live list of employees currently checked in but not "
                "yet checked out. Includes their check-in time."
            ),
            "parameters": {"type": "object", "properties": {}}
        }
    },
    "recent_biometric_scans": {
        "fn": tool_recent_biometric_scans,
        "decl": {
            "name": "recent_biometric_scans",
            "description": (
                "Last few biometric gate scan events with employee, "
                "device, time and result."
            ),
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer"}}
            }
        }
    },
    "find_employee": {
        "fn": tool_find_employee,
        "decl": {
            "name": "find_employee",
            "description": (
                "Look up an employee by name, code, or email. Returns "
                "profile + skills + active tasks + tasks completed today."
            ),
            "parameters": {
                "type": "object",
                "properties": {"name_or_code": {"type": "string"}},
                "required": ["name_or_code"]
            }
        }
    },
    "list_employees": {
        "fn": tool_list_employees,
        "decl": {
            "name": "list_employees",
            "description": (
                "List active employees. Optionally filter by department "
                "(name or code) or skill keyword (e.g. 'welding')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "department": {"type": "string"},
                    "skill": {"type": "string"},
                    "limit": {"type": "integer"}
                }
            }
        }
    },
    "performance_summary": {
        "fn": tool_performance_summary,
        "decl": {
            "name": "performance_summary",
            "description": (
                "MD-level performance review for the period. Returns "
                "average score, top performer, lowest performer, and "
                "every employee's score + suggested increment %. "
                "Default period is 30 days."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Look-back window in days"
                    }
                }
            }
        }
    },
    "inventory_status": {
        "fn": tool_inventory_status,
        "decl": {
            "name": "inventory_status",
            "description": (
                "Raw material inventory snapshot: total items, low stock "
                "count + samples, out-of-stock count, total inventory value."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "low_threshold": {
                        "type": "integer",
                        "description": "Quantity below this is 'low stock'"
                    }
                }
            }
        }
    },
    "pending_tasks": {
        "fn": tool_pending_tasks,
        "decl": {
            "name": "pending_tasks",
            "description": (
                "List pending / in-progress tasks across the company "
                "or for a specific employee."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "employee_code": {"type": "string"},
                    "limit": {"type": "integer"}
                }
            }
        }
    }
}


def _all_function_declarations():

    return [t["decl"] for t in TOOL_REGISTRY.values()]


# ----------------------------------------------------------------
# Gemini chat with streaming + tool calling
# ----------------------------------------------------------------

def _build_model(model_name: str):
    """Lazy import + configure to avoid hard dependency for users
    who haven't installed google-generativeai yet."""

    import google.generativeai as genai

    genai.configure(api_key=GEMINI_API_KEY)

    today_str = date.today().strftime("%A, %d %B %Y")

    sys_prompt = (
        SYSTEM_INSTRUCTION
        + f"\n\nContext: today is {today_str}."
    )

    return genai.GenerativeModel(
        model_name=model_name,
        tools=[{"function_declarations": _all_function_declarations()}],
        system_instruction=sys_prompt
    )


def _build_model_with_fallback(history):
    """Try each candidate model in order; the first one that
    successfully accepts start_chat() wins. Returns (model, chat,
    used_model_name). Raises the last error if none work."""

    import google.generativeai as genai

    last_err = None

    for name in GEMINI_MODEL_FALLBACKS:

        try:

            model = _build_model(name)

            chat = model.start_chat(history=history)

            return model, chat, name

        except Exception as e:

            last_err = e

            # Try next fallback. NotFound on 2.0 means we should
            # try 1.5; any other transient error -> also try next
            continue

    raise last_err or RuntimeError("No Gemini model available")


def stream_chat(
    db: Session,
    user_message: str,
    history: Optional[List[Dict]] = None
):
    """
    Generator that yields dicts:
      {"type": "tool",  "name": str, "args": dict}
      {"type": "text",  "text": str}    # streaming token chunks
      {"type": "done"}
      {"type": "error", "message": str}

    The route layer turns each dict into an SSE frame.
    """

    if not is_gemini_configured():

        yield {
            "type": "error",
            "message": (
                "Gemini API not configured. Set GEMINI_API_KEY in "
                "backend/.env (free key at "
                "https://aistudio.google.com/apikey)."
            )
        }

        return

    try:

        import google.generativeai as genai

    except ImportError:

        yield {
            "type": "error",
            "message": (
                "google-generativeai not installed. "
                "Run: pip install -r requirements-ai.txt"
            )
        }

        return

    try:

        # Map prior history (frontend format) into Gemini format.
        # Each item is {role: 'user'|'model', text: str}.
        gemini_history = []

        for h in (history or []):

            role = h.get("role")

            text = h.get("text", "")

            if role in ("user", "model") and text:

                gemini_history.append({
                    "role": role,
                    "parts": [text]
                })

        # Try the candidate model list. The first one that lets us
        # send_message() wins. This survives Google retiring the
        # -exp models without code changes.
        # Collect per-model errors so when EVERY fallback fails we
        # can show the full picture instead of just the last error
        # (the old behavior made it look like only the last model
        # was broken — misleading the user).
        attempt_errors = []

        response = None

        model = None

        chat = None

        used_model = None

        for name in GEMINI_MODEL_FALLBACKS:

            try:

                model = _build_model(name)

                chat = model.start_chat(history=gemini_history)

                response = chat.send_message(user_message)

                used_model = name

                break

            except Exception as e:

                attempt_errors.append(f"{name}: {type(e).__name__}: {e}")

                continue

        if response is None:

            detail = "\n  ".join(attempt_errors) or "no models tried"

            raise RuntimeError(
                "Every Gemini model failed.\n  "
                + detail
                + "\n\nUpdate GEMINI_MODEL in backend/.env to one "
                "of the currently-supported models: "
                "gemini-2.5-flash, gemini-2.5-flash-lite, "
                "gemini-2.0-flash."
            )

        # ---- Function calling loop ---------------------------------
        # Gemini may want to call one or more tools before producing
        # the final answer. Resolve them, send results back, until
        # the model responds with plain text.

        max_hops = 5

        for _ in range(max_hops):

            fn_calls = []

            # Collect any function_call parts from the latest reply
            try:

                for part in response.candidates[0].content.parts:

                    if part.function_call and part.function_call.name:

                        fn_calls.append(part.function_call)

            except (IndexError, AttributeError):

                fn_calls = []

            if not fn_calls:

                break

            tool_responses = []

            for fc in fn_calls:

                tool_name = fc.name

                # Convert protobuf MapComposite args to dict
                args = dict(fc.args) if fc.args else {}

                yield {
                    "type": "tool",
                    "name": tool_name,
                    "args": args
                }

                tool = TOOL_REGISTRY.get(tool_name)

                if not tool:

                    result = {"error": f"unknown tool: {tool_name}"}

                else:

                    try:

                        result = tool["fn"](db=db, **args)

                    except Exception as e:

                        result = {"error": str(e)}

                tool_responses.append(
                    genai.protos.Part(
                        function_response=genai.protos.FunctionResponse(
                            name=tool_name,
                            response={"result": result}
                        )
                    )
                )

            # Send all tool results back in one turn
            response = chat.send_message(
                genai.protos.Content(parts=tool_responses)
            )

        # ---- Stream the final text response ------------------------
        try:

            final_text = response.text or ""

        except Exception:

            final_text = ""

        if not final_text:

            yield {
                "type": "text",
                "text": (
                    "I couldn't formulate a reply for that. "
                    "Try rephrasing or asking for a specific module "
                    "like 'production status' or 'who is on leave today'."
                )
            }

        else:

            # Chunk by ~4-character pieces to simulate ChatGPT typewriter
            for i in range(0, len(final_text), 4):

                yield {"type": "text", "text": final_text[i:i + 4]}

        yield {"type": "done"}

    except Exception as e:

        msg = f"{type(e).__name__}: {e}"

        hint = ""

        low = msg.lower()

        if "404" in msg or "not found" in low or "notfound" in low:

            hint = (
                "\n\nThe model name your account can access has "
                "changed. Try one of these in backend/.env:\n"
                "  GEMINI_MODEL=gemini-2.5-flash\n"
                "  GEMINI_MODEL=gemini-2.0-flash\n"
                "  GEMINI_MODEL=gemini-1.5-flash\n"
                "Then restart the backend."
            )

        elif "permission" in low or "api key" in low or "401" in msg or "403" in msg:

            hint = (
                "\n\nCheck your GEMINI_API_KEY in backend/.env. "
                "Get a fresh key at https://aistudio.google.com/apikey"
            )

        elif "quota" in low or "429" in msg or "rate" in low:

            hint = (
                "\n\nGemini free-tier quota hit (15 req/min, "
                "1500/day). Wait a minute and try again, or "
                "rephrase using a rule-based query like "
                "'production status'."
            )

        yield {
            "type": "error",
            "message": f"Gemini error: {msg}{hint}"
        }
