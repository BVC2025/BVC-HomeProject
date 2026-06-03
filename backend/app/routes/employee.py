from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pathlib import Path
import re
import shutil
import uuid

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import Optional

from app.database.database import get_db

from app.models.models import (
    Employee,
    Department,
    Designation,
    Role,
    Task,
    TaskAssignment,
    Attendance
)

from app.schemas.employee_schema import (
    EmployeeCreate,
    EmployeeUpdate,
    EmployeePasswordReset
)

from app.services.auth_service import hash_password


router = APIRouter()


# =========================
# SERIALIZATION
# =========================

def serialize_employee(emp: Employee, db: Session):
    """
    Returns a fat row with the joined dept/designation/role
    names. Frontend doesn't have to make extra calls.
    """

    dept = None

    if emp.DEPARTMENT_ID:

        d = db.query(Department).filter(
            Department.ID == emp.DEPARTMENT_ID
        ).first()

        dept = {"ID": d.ID, "NAME": d.NAME, "CODE": d.CODE} if d else None

    des = None

    if emp.DESIGNATION_ID:

        x = db.query(Designation).filter(
            Designation.ID == emp.DESIGNATION_ID
        ).first()

        des = {"ID": x.ID, "TITLE": x.TITLE} if x else None

    role = None

    if emp.ROLE_ID:

        r = db.query(Role).filter(Role.ID == emp.ROLE_ID).first()

        role = {"ID": r.ID, "NAME": r.ROLE_NAME} if r else None

    return {
        "ID": emp.ID,
        "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
        "NAME": emp.NAME,
        "EMAIL": emp.EMAIL,
        "PHONE": emp.PHONE,
        "DEPARTMENT": dept,
        "DESIGNATION": des,
        "ROLE": role,
        "DEPARTMENT_ID": emp.DEPARTMENT_ID,
        "DESIGNATION_ID": emp.DESIGNATION_ID,
        "ROLE_ID": emp.ROLE_ID,
        "REPORTING_MANAGER_ID": emp.REPORTING_MANAGER_ID,
        "JOINING_DATE": (
            emp.JOINING_DATE.isoformat()
            if emp.JOINING_DATE else None
        ),
        "SALARY": emp.SALARY,
        "SHIFT_START": (
            emp.SHIFT_START.isoformat()
            if emp.SHIFT_START else None
        ),
        "SHIFT_END": (
            emp.SHIFT_END.isoformat()
            if emp.SHIFT_END else None
        ),
        "STATUS": emp.STATUS,
        "SKILLS": emp.SKILLS,
        "VENDOR_ID": emp.VENDOR_ID,
        # Profile / resume fields
        "ADDRESS": emp.ADDRESS,
        "CITY": emp.CITY,
        "STATE": emp.STATE,
        "PINCODE": emp.PINCODE,
        "DOB": emp.DOB.isoformat() if emp.DOB else None,
        "GENDER": emp.GENDER,
        "FATHER_NAME": emp.FATHER_NAME,
        "MOTHER_NAME": emp.MOTHER_NAME,
        "MARITAL_STATUS": emp.MARITAL_STATUS,
        "OCCUPATION": emp.OCCUPATION,
        "QUALIFICATION": emp.QUALIFICATION,
        "YEAR_OF_PASSING": emp.YEAR_OF_PASSING,
        "EXPERIENCE_YEARS": emp.EXPERIENCE_YEARS,
        "EXPERIENCE_DETAILS": emp.EXPERIENCE_DETAILS,
        "PAST_PROJECTS": emp.PAST_PROJECTS,
        "EMPLOYMENT_TYPE": emp.EMPLOYMENT_TYPE,
        "NOTES": emp.NOTES,
        "PHOTO_URL": emp.PHOTO_URL,
        "PROFILE_SUBMITTED": bool(emp.PROFILE_SUBMITTED),
        # Phase A — HR Module expansion
        "BLOOD_GROUP":                emp.BLOOD_GROUP,
        "NATIONALITY":                emp.NATIONALITY,
        "EMERGENCY_CONTACT_NAME":     emp.EMERGENCY_CONTACT_NAME,
        "EMERGENCY_CONTACT_PHONE":    emp.EMERGENCY_CONTACT_PHONE,
        "EMERGENCY_CONTACT_RELATION": emp.EMERGENCY_CONTACT_RELATION,
        "CONFIRMATION_DATE": (
            emp.CONFIRMATION_DATE.isoformat()
            if emp.CONFIRMATION_DATE else None
        ),
        "WORK_LOCATION":      emp.WORK_LOCATION,
        "COLLEGE":            emp.COLLEGE,
        "UNIVERSITY":         emp.UNIVERSITY,
        "PERCENTAGE":         emp.PERCENTAGE,
        "PREVIOUS_COMPANY":   emp.PREVIOUS_COMPANY,
        "PREVIOUS_SALARY":    emp.PREVIOUS_SALARY,
        "BANK_ACCOUNT_NUMBER": emp.BANK_ACCOUNT_NUMBER,
        "BANK_NAME":          emp.BANK_NAME,
        "IFSC_CODE":          emp.IFSC_CODE,
        "PAN_NUMBER":         emp.PAN_NUMBER,
        "AADHAAR_NUMBER":     emp.AADHAAR_NUMBER,
    }


# =========================
# CREATE
# =========================

@router.post("/create-employee")
def create_employee(
    data: EmployeeCreate,
    db: Session = Depends(get_db)
):

    if db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == data.EMPLOYEE_CODE.upper()
    ).first():

        raise HTTPException(
            status_code=400,
            detail=f"Employee code '{data.EMPLOYEE_CODE}' already exists"
        )

    if data.EMAIL and db.query(Employee).filter(
        Employee.EMAIL == data.EMAIL
    ).first():

        raise HTTPException(
            status_code=400,
            detail="An employee with this email already exists"
        )

    emp = Employee(
        EMPLOYEE_CODE=data.EMPLOYEE_CODE.upper(),
        NAME=data.NAME,
        EMAIL=data.EMAIL,
        PHONE=data.PHONE,
        PASSWORD=hash_password(data.PASSWORD),
        DEPARTMENT_ID=data.DEPARTMENT_ID,
        DESIGNATION_ID=data.DESIGNATION_ID,
        ROLE_ID=data.ROLE_ID,
        REPORTING_MANAGER_ID=data.REPORTING_MANAGER_ID,
        JOINING_DATE=data.JOINING_DATE,
        SALARY=data.SALARY or 0.0,
        SHIFT_START=data.SHIFT_START,
        SHIFT_END=data.SHIFT_END,
        SKILLS=data.SKILLS,
        STATUS="ACTIVE",
        VENDOR_ID=data.VENDOR_ID,
        # Profile / resume fields
        ADDRESS=data.ADDRESS,
        CITY=data.CITY,
        STATE=data.STATE,
        PINCODE=data.PINCODE,
        DOB=data.DOB,
        GENDER=data.GENDER,
        FATHER_NAME=data.FATHER_NAME,
        MOTHER_NAME=data.MOTHER_NAME,
        MARITAL_STATUS=data.MARITAL_STATUS,
        OCCUPATION=data.OCCUPATION,
        QUALIFICATION=data.QUALIFICATION,
        YEAR_OF_PASSING=data.YEAR_OF_PASSING,
        EXPERIENCE_YEARS=data.EXPERIENCE_YEARS or 0.0,
        EXPERIENCE_DETAILS=data.EXPERIENCE_DETAILS,
        PAST_PROJECTS=data.PAST_PROJECTS,
        EMPLOYMENT_TYPE=data.EMPLOYMENT_TYPE,
        NOTES=data.NOTES,
        # Phase A — HR Module expansion
        BLOOD_GROUP=data.BLOOD_GROUP,
        NATIONALITY=data.NATIONALITY,
        EMERGENCY_CONTACT_NAME=data.EMERGENCY_CONTACT_NAME,
        EMERGENCY_CONTACT_PHONE=data.EMERGENCY_CONTACT_PHONE,
        EMERGENCY_CONTACT_RELATION=data.EMERGENCY_CONTACT_RELATION,
        CONFIRMATION_DATE=data.CONFIRMATION_DATE,
        WORK_LOCATION=data.WORK_LOCATION,
        COLLEGE=data.COLLEGE,
        UNIVERSITY=data.UNIVERSITY,
        PERCENTAGE=data.PERCENTAGE,
        PREVIOUS_COMPANY=data.PREVIOUS_COMPANY,
        PREVIOUS_SALARY=data.PREVIOUS_SALARY,
        BANK_ACCOUNT_NUMBER=data.BANK_ACCOUNT_NUMBER,
        BANK_NAME=data.BANK_NAME,
        IFSC_CODE=data.IFSC_CODE,
        PAN_NUMBER=data.PAN_NUMBER,
        AADHAAR_NUMBER=data.AADHAAR_NUMBER,
    )

    db.add(emp)

    try:

        db.commit()

    except IntegrityError as e:

        db.rollback()

        # MySQL 1062 duplicate-key — surface a friendly message instead
        # of crashing the worker.
        raw = str(getattr(e, "orig", e))

        if "EMAIL" in raw.upper():

            raise HTTPException(
                status_code=400,
                detail=(
                    "An employee with this email already exists. "
                    "Leave the field blank if the employee has no email."
                )
            )

        if "EMPLOYEE_CODE" in raw.upper():

            raise HTTPException(
                status_code=400,
                detail=f"Employee code '{data.EMPLOYEE_CODE}' already exists"
            )

        if "FINGERPRINT_ID" in raw.upper():

            raise HTTPException(
                status_code=400,
                detail="That fingerprint ID is already enrolled to another employee."
            )

        raise HTTPException(
            status_code=400,
            detail=f"Database rejected the record: {raw[:200]}"
        )

    db.refresh(emp)

    return {
        "message": "Employee created successfully",
        "employee_id": emp.ID,
        "EMPLOYEE_CODE": emp.EMPLOYEE_CODE
    }


# =========================
# LIST
# =========================

@router.get("/employees")
def get_employees(
    department_id: Optional[int] = Query(None),
    role_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Employee)

    if department_id is not None:

        q = q.filter(Employee.DEPARTMENT_ID == department_id)

    if role_id is not None:

        q = q.filter(Employee.ROLE_ID == role_id)

    if status:

        q = q.filter(Employee.STATUS == status.upper())

    if vendor_id is not None:

        q = q.filter(Employee.VENDOR_ID == vendor_id)

    rows = q.order_by(Employee.EMPLOYEE_CODE).all()

    return [serialize_employee(e, db) for e in rows]


@router.get("/employees/{employee_id}")
def get_one_employee(
    employee_id: str,
    db: Session = Depends(get_db)
):

    emp = db.query(Employee).filter(
        Employee.ID == employee_id
    ).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    return serialize_employee(emp, db)


# =========================
# Self-service — by EMPLOYEE_CODE
# =========================

@router.get("/employees/by-code/{code}")
def get_employee_by_code(
    code: str,
    db: Session = Depends(get_db)
):
    """Look up the logged-in employee by their EMPLOYEE_CODE (the
    same code stored in localStorage on login). Used by the
    EmployeeDashboard to decide whether to show the self-registration
    form or the read-only resume view."""

    emp = db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == code.upper().strip()
    ).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    return serialize_employee(emp, db)


@router.post("/employees/by-code/{code}/submit-profile")
def submit_own_profile(
    code: str,
    data: EmployeeUpdate,
    db: Session = Depends(get_db)
):
    """Employee's one-shot self-registration. Updates the row with
    every field they submitted and flips PROFILE_SUBMITTED → 1.

    Refuses if PROFILE_SUBMITTED is already 1 — admin-only after that
    (admin uses /update-employee/{id}).

    Admin-controlled fields (ROLE_ID, DEPARTMENT_ID, DESIGNATION_ID,
    EMPLOYEE_CODE, PASSWORD, SALARY) are silently dropped from the
    payload so the employee can't promote themselves.
    """

    emp = db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == code.upper().strip()
    ).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    if emp.PROFILE_SUBMITTED:

        raise HTTPException(
            status_code=400,
            detail=(
                "Your profile has already been submitted. Contact "
                "admin if any of your details need updating."
            )
        )

    payload = data.model_dump(exclude_unset=True)

    # Admin-only fields the employee should never be able to set
    # via this endpoint
    blocked = {
        "ROLE_ID", "DEPARTMENT_ID", "DESIGNATION_ID",
        "SALARY", "STATUS", "REPORTING_MANAGER_ID",
        "SHIFT_START", "SHIFT_END"
    }

    for field, value in payload.items():

        if field in blocked:

            continue

        setattr(emp, field, value)

    emp.PROFILE_SUBMITTED = 1

    db.commit()

    db.refresh(emp)

    return {
        "message": "Profile submitted successfully",
        "employee": serialize_employee(emp, db)
    }


# =========================
# UPDATE
# =========================

@router.put("/update-employee/{employee_id}")
def update_employee(
    employee_id: str,
    data: EmployeeUpdate,
    db: Session = Depends(get_db)
):

    emp = db.query(Employee).filter(
        Employee.ID == employee_id
    ).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    for field, value in data.model_dump(exclude_unset=True).items():

        setattr(emp, field, value)

    db.commit()

    return {"message": "Employee updated successfully"}


@router.put("/employees/{employee_id}/reset-password")
def reset_password(
    employee_id: str,
    data: EmployeePasswordReset,
    db: Session = Depends(get_db)
):

    emp = db.query(Employee).filter(
        Employee.ID == employee_id
    ).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    emp.PASSWORD = hash_password(data.NEW_PASSWORD)

    db.commit()

    return {"message": "Password reset successfully"}


# =========================
# DELETE
# =========================

# =========================
# PHOTO UPLOAD
# =========================

_ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}

_STATIC_EMPLOYEE_DIR = (
    Path(__file__).resolve().parent.parent.parent / "static" / "employee"
)


def _safe_slug(text: str) -> str:

    cleaned = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")

    return cleaned[:40] or "emp"


@router.post("/employees/{employee_id}/upload-photo")
def upload_employee_photo(
    employee_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Save a passport-size photo for the employee and store the
    public /static/employee/<file> URL on Employee.PHOTO_URL.

    Replaces the previous photo if one exists (old file is removed)
    so /static doesn't bloat over time."""

    emp = db.query(Employee).filter(
        Employee.ID == employee_id
    ).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    ext = Path(file.filename or "").suffix.lower()

    if ext not in _ALLOWED_IMAGE_EXTS:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported image type '{ext}'. Allowed: "
                + ", ".join(sorted(_ALLOWED_IMAGE_EXTS))
            )
        )

    _STATIC_EMPLOYEE_DIR.mkdir(parents=True, exist_ok=True)

    slug = _safe_slug(emp.EMPLOYEE_CODE or emp.NAME)

    fname = f"emp-{slug}-{uuid.uuid4().hex[:6]}{ext}"

    dest = _STATIC_EMPLOYEE_DIR / fname

    with dest.open("wb") as out:

        shutil.copyfileobj(file.file, out)

    # Clean up the previous photo to avoid orphan files
    if emp.PHOTO_URL:

        try:

            old_name = emp.PHOTO_URL.rsplit("/", 1)[-1]

            old_path = _STATIC_EMPLOYEE_DIR / old_name

            if old_path.exists() and old_path.is_file():

                old_path.unlink()

        except Exception:

            pass

    public_url = f"/static/employee/{fname}"

    emp.PHOTO_URL = public_url

    db.commit()

    db.refresh(emp)

    return {
        "message": "Photo uploaded",
        "photo_url": public_url,
        "employee_id": emp.ID
    }


@router.post("/employees/wipe-all")
def wipe_all_employees(
    keep_admin: bool = True,
    db: Session = Depends(get_db)
):
    """Nuclear option — wipes every employee and every row that
    references one. Use when you want to reset the workforce
    completely and re-enter from scratch.

    Query params:
      keep_admin (default True) — keeps the SUPER_ADMIN account
        so you can still log in. Pass `?keep_admin=false` to also
        wipe the admin (then re-seed via /bvc24/seed-all).

    Uses MySQL's `SET FOREIGN_KEY_CHECKS=0` so the deletes never
    fail on FK constraints. We re-enable checks at the end. Photo
    files on disk are also cleaned up.
    """

    # Build the keep-list
    keep_codes = ["ADMIN"] if keep_admin else []

    keep_clause = ""

    params = {}

    if keep_codes:

        placeholders = ", ".join(
            f":code_{i}" for i in range(len(keep_codes))
        )

        keep_clause = f" WHERE EMPLOYEE_CODE NOT IN ({placeholders})"

        for i, c in enumerate(keep_codes):

            params[f"code_{i}"] = c

    # Photo files: collect on-disk paths BEFORE we lose the rows
    photo_urls = [
        row[0]
        for row in db.query(Employee.PHOTO_URL).filter(
            Employee.PHOTO_URL.isnot(None)
        ).all()
        if row[0]
    ]

    if keep_codes:

        # Restrict the photo cleanup to employees we're actually
        # deleting (re-fetch with the kept-codes filter inverted)
        kept_photos = {
            row[0]
            for row in db.query(Employee.PHOTO_URL).filter(
                Employee.PHOTO_URL.isnot(None),
                Employee.EMPLOYEE_CODE.in_(keep_codes)
            ).all()
            if row[0]
        }

        photo_urls = [p for p in photo_urls if p not in kept_photos]

    summary = {}

    try:

        # 1. Turn off FK checks for the duration of the wipe
        db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

        # 2. Truncate-style deletes on every child table
        child_tables = [
            "attendance",
            "biometric_event",
            "daily_allocation",
            "task_assignment",
            "leave_request",
            "leave_balance",
            "payroll_slip",
            "payroll_run"
        ]

        for t in child_tables:

            try:

                if keep_codes:

                    # Per-table delete restricted to rows belonging
                    # to non-kept employees. Some tables don't have
                    # EMPLOYEE_ID (e.g. payroll_run), so wrap each.
                    if t == "payroll_run":

                        # payroll_run rows are global, not per-emp.
                        # Skip when keeping admin since the runs are
                        # still useful history.
                        continue

                    sql = (
                        f"DELETE FROM {t} WHERE EMPLOYEE_ID IN "
                        f"(SELECT ID FROM employee{keep_clause})"
                    )

                else:

                    sql = f"DELETE FROM {t}"

                result = db.execute(text(sql), params)

                summary[t] = result.rowcount

            except Exception as exc:

                summary[t] = f"skipped: {type(exc).__name__}"

        # 3. Null-out history-bearing references
        null_outs = [
            ("task", "ASSIGNED_TO"),
            ("wo_stage_progress", "ASSIGNED_TO_ID"),
            ("qc_inspection", "INSPECTOR_ID"),
            ("ncr", "REPORTED_BY_ID"),
            ("ncr", "ASSIGNED_TO_ID"),
            ("department", "HEAD_EMPLOYEE_ID")
        ]

        for table, col in null_outs:

            try:

                if keep_codes:

                    sql = (
                        f"UPDATE {table} SET {col} = NULL "
                        f"WHERE {col} IN "
                        f"(SELECT ID FROM employee{keep_clause})"
                    )

                else:

                    sql = f"UPDATE {table} SET {col} = NULL"

                result = db.execute(text(sql), params)

                summary[f"{table}.{col}"] = result.rowcount

            except Exception as exc:

                summary[f"{table}.{col}"] = (
                    f"skipped: {type(exc).__name__}"
                )

        # 4. Null-out task_assignment.ASSIGNED_BY_ID (we already
        # deleted rows above but in case any survived via keep_admin)
        try:

            if keep_codes:

                sql = (
                    "UPDATE task_assignment SET ASSIGNED_BY_ID = NULL "
                    "WHERE ASSIGNED_BY_ID IN "
                    f"(SELECT ID FROM employee{keep_clause})"
                )

            else:

                sql = "UPDATE task_assignment SET ASSIGNED_BY_ID = NULL"

            result = db.execute(text(sql), params)

            summary["task_assignment.ASSIGNED_BY_ID"] = result.rowcount

        except Exception as exc:

            summary["task_assignment.ASSIGNED_BY_ID"] = (
                f"skipped: {type(exc).__name__}"
            )

        # 5. Null out employee.REPORTING_MANAGER_ID (self-ref)
        try:

            if keep_codes:

                sql = (
                    "UPDATE employee SET REPORTING_MANAGER_ID = NULL "
                    "WHERE REPORTING_MANAGER_ID IN "
                    f"(SELECT ID FROM (SELECT ID FROM employee{keep_clause}) e)"
                )

            else:

                sql = "UPDATE employee SET REPORTING_MANAGER_ID = NULL"

            result = db.execute(text(sql), params)

            summary["employee.REPORTING_MANAGER_ID"] = result.rowcount

        except Exception:

            summary["employee.REPORTING_MANAGER_ID"] = "skipped"

        # 6. Finally delete the employees themselves
        if keep_codes:

            sql = f"DELETE FROM employee{keep_clause}"

        else:

            sql = "DELETE FROM employee"

        result = db.execute(text(sql), params)

        summary["employee"] = result.rowcount

        # 7. Re-enable FK checks
        db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

        db.commit()

    except Exception as exc:

        db.rollback()

        # Even on failure, ensure FK checks are back on
        try:

            db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

            db.commit()

        except Exception:

            pass

        raise HTTPException(
            status_code=500,
            detail=f"Wipe failed mid-way: {exc}"
        )

    # 8. Clean up photo files on disk
    photo_files_removed = 0

    for url in photo_urls:

        try:

            fname = url.rsplit("/", 1)[-1]

            fpath = _STATIC_EMPLOYEE_DIR / fname

            if fpath.exists() and fpath.is_file():

                fpath.unlink()

                photo_files_removed += 1

        except Exception:

            pass

    return {
        "message": (
            f"Employee data wiped. "
            f"{summary.get('employee', 0)} employee(s) removed. "
            + (f"ADMIN kept." if keep_admin else "Everything gone.")
        ),
        "kept": keep_codes,
        "summary": summary,
        "photo_files_removed": photo_files_removed
    }


@router.delete("/delete-employee/{employee_id}")
def delete_employee(
    employee_id: str,
    db: Session = Depends(get_db)
):
    """Full-cascade delete for an employee. Clears every FK from
    related tables (attendance, leaves, allocations, biometric
    events, payroll slips, task assignments, etc.) then removes
    the employee row.

    History-bearing rows (Tasks, WorkOrderStageProgress, QC
    inspections, Department head, photos uploaded by them) have
    their EMPLOYEE_ID pointer set to NULL so the records survive
    — losing the human-readable name is preferable to losing
    months of attendance / task history.
    """

    # Lazy-import the optional models so we don't break startup if
    # someone removes one of them. Each branch is wrapped in
    # try/except so a missing table never aborts the cascade.
    from app.models.models import (
        DailyAllocation,
        LeaveRequest,
        LeaveBalance,
        BiometricEvent,
        PayrollSlip,
        WorkOrderStageProgress,
        QCInspection,
        Department,
        Machine,
        NCR,
        PerformanceScore,
        Customer,
        Quotation,
        SalesOrder,
        PurchaseOrder,
        EmployeeOnboardingSession,
        EmployeeDocument
    )

    # Path to clean up document files on disk
    from pathlib import Path
    _DOCS_DIR = (
        Path(__file__).resolve().parent.parent.parent
        / "static" / "employee-docs"
    )

    # GoodsReceiptNote is optional — wrap import so a missing model
    # doesn't break the cascade.
    try:
        from app.models.models import GoodsReceiptNote
    except ImportError:
        GoodsReceiptNote = None

    emp = db.query(Employee).filter(
        Employee.ID == employee_id
    ).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    counts = {}

    def _try(label, action):
        """Run an action and COMMIT it immediately so each step is
        durable. If any step fails we rollback ONLY that step and
        carry on — earlier successful deletes stay applied.

        The old version did `db.rollback()` after a failure but
        rollback undoes ALL pending session state. That meant one
        failed step wiped out every previous step's deletes, so
        when we reached the final delete employee the FK refs
        were still there → IntegrityError."""

        try:

            n = action()

            db.commit()

            counts[label] = int(n) if n is not None else 0

        except Exception as exc:

            db.rollback()

            counts[label] = (
                f"skipped: {type(exc).__name__}: {str(exc)[:80]}"
            )

    # ---- 1. Delete pure child rows (no history value worth keeping)
    _try("biometric_events", lambda: db.query(BiometricEvent)
         .filter(BiometricEvent.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    _try("daily_allocations", lambda: db.query(DailyAllocation)
         .filter(DailyAllocation.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    _try("leave_requests", lambda: db.query(LeaveRequest)
         .filter(LeaveRequest.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    _try("leave_balances", lambda: db.query(LeaveBalance)
         .filter(LeaveBalance.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    _try("attendance", lambda: db.query(Attendance)
         .filter(Attendance.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    _try("payroll_slips", lambda: db.query(PayrollSlip)
         .filter(PayrollSlip.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    _try("task_assignments", lambda: db.query(TaskAssignment)
         .filter(TaskAssignment.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    # PerformanceScore rows are per-employee monthly aggregates and
    # have no value once the employee is gone — delete outright.
    _try("performance_scores", lambda: db.query(PerformanceScore)
         .filter(PerformanceScore.EMPLOYEE_ID == employee_id)
         .delete(synchronize_session=False))

    # ---- 2. Null-out history-bearing references ----

    # Customer.ASSIGNED_SALES_ID — customers keep, just lose their
    # sales-rep pointer.
    _try("customers_sales_unlinked", lambda: db.query(Customer)
         .filter(Customer.ASSIGNED_SALES_ID == employee_id)
         .update({Customer.ASSIGNED_SALES_ID: None},
                 synchronize_session=False))

    # Quotation / SalesOrder / PurchaseOrder PREPARED_BY — keep the
    # business docs, lose the preparer name.
    _try("quotations_preparer_unlinked", lambda: db.query(Quotation)
         .filter(Quotation.PREPARED_BY == employee_id)
         .update({Quotation.PREPARED_BY: None},
                 synchronize_session=False))

    _try("sales_orders_preparer_unlinked", lambda: db.query(SalesOrder)
         .filter(SalesOrder.PREPARED_BY == employee_id)
         .update({SalesOrder.PREPARED_BY: None},
                 synchronize_session=False))

    _try("purchase_orders_preparer_unlinked", lambda: db.query(PurchaseOrder)
         .filter(PurchaseOrder.PREPARED_BY == employee_id)
         .update({PurchaseOrder.PREPARED_BY: None},
                 synchronize_session=False))

    # GoodsReceiptNote.RECEIVED_BY — optional table
    if GoodsReceiptNote is not None and hasattr(GoodsReceiptNote, "RECEIVED_BY"):

        _try("grn_receiver_unlinked", lambda: db.query(GoodsReceiptNote)
             .filter(GoodsReceiptNote.RECEIVED_BY == employee_id)
             .update({GoodsReceiptNote.RECEIVED_BY: None},
                     synchronize_session=False))

    # EmployeeOnboardingSession.EMPLOYEE_ID + APPROVED_BY_ID — null out
    # so the session row survives as audit history (how the employee
    # was hired) but no longer FKs to the deleted employee.
    _try("onboarding_sessions_emp_unlinked",
         lambda: db.query(EmployeeOnboardingSession)
             .filter(EmployeeOnboardingSession.EMPLOYEE_ID == employee_id)
             .update({EmployeeOnboardingSession.EMPLOYEE_ID: None},
                     synchronize_session=False))

    _try("onboarding_sessions_approver_unlinked",
         lambda: db.query(EmployeeOnboardingSession)
             .filter(EmployeeOnboardingSession.APPROVED_BY_ID == employee_id)
             .update({EmployeeOnboardingSession.APPROVED_BY_ID: None},
                     synchronize_session=False))

    # ---- HR Documents (Phase B) ----
    # Hard-delete every document row + best-effort remove their files
    # and the per-employee folder.
    import re as _re

    safe_emp = _re.sub(r"[^A-Za-z0-9._-]+", "_", employee_id)[:64]

    emp_doc_dir = _DOCS_DIR / safe_emp

    if emp_doc_dir.exists() and emp_doc_dir.is_dir():

        try:

            import shutil as _shutil

            _shutil.rmtree(emp_doc_dir)

            counts["doc_folder_removed"] = True

        except Exception as exc:

            counts["doc_folder_removed"] = f"skipped: {exc!s}"

    # Null-out FK on docs uploaded BY this employee (admin uploads against
    # other people) so those still-relevant docs survive.
    _try("docs_uploader_unlinked",
         lambda: db.query(EmployeeDocument)
             .filter(EmployeeDocument.UPLOADED_BY_ID == employee_id)
             .update({EmployeeDocument.UPLOADED_BY_ID: None},
                     synchronize_session=False))

    # Hard-delete docs that belong TO this employee (already removed
    # files above; this drops the rows).
    _try("employee_documents",
         lambda: db.query(EmployeeDocument)
             .filter(EmployeeDocument.EMPLOYEE_ID == employee_id)
             .delete(synchronize_session=False))
    _try("tasks_unlinked", lambda: db.query(Task)
         .filter(Task.ASSIGNED_TO == employee_id)
         .update({Task.ASSIGNED_TO: None}, synchronize_session=False))

    _try("wo_stages_unlinked", lambda: db.query(WorkOrderStageProgress)
         .filter(WorkOrderStageProgress.ASSIGNED_TO_ID == employee_id)
         .update({WorkOrderStageProgress.ASSIGNED_TO_ID: None},
                 synchronize_session=False))

    _try("qc_inspections_unlinked", lambda: db.query(QCInspection)
         .filter(QCInspection.INSPECTOR_ID == employee_id)
         .update({QCInspection.INSPECTOR_ID: None},
                 synchronize_session=False))

    _try("department_heads_unlinked", lambda: db.query(Department)
         .filter(Department.HEAD_EMPLOYEE_ID == employee_id)
         .update({Department.HEAD_EMPLOYEE_ID: None},
                 synchronize_session=False))

    _try("reports_unlinked", lambda: db.query(Employee)
         .filter(Employee.REPORTING_MANAGER_ID == employee_id)
         .update({Employee.REPORTING_MANAGER_ID: None},
                 synchronize_session=False))

    # task_assignment also has ASSIGNED_BY_ID; we already deleted
    # rows where this employee is the assignee, but we may have
    # left tasks where this person was the assigner.
    _try("task_assigners_unlinked", lambda: db.query(TaskAssignment)
         .filter(TaskAssignment.ASSIGNED_BY_ID == employee_id)
         .update({TaskAssignment.ASSIGNED_BY_ID: None},
                 synchronize_session=False))

    # Machine + NCR have optional employee FKs depending on schema
    # version. _try catches column-doesn't-exist and moves on.
    if hasattr(Machine, "ASSIGNED_TO"):

        _try("machines_unlinked", lambda: db.query(Machine)
             .filter(Machine.ASSIGNED_TO == employee_id)
             .update({Machine.ASSIGNED_TO: None},
                     synchronize_session=False))

    # NCR has TWO employee FKs that block deletes: REPORTED_BY_ID
    # and ASSIGNED_TO_ID. Both must be nulled out before the
    # employee row can be removed.
    for fk_field in ("REPORTED_BY_ID", "ASSIGNED_TO_ID"):

        if hasattr(NCR, fk_field):

            col = getattr(NCR, fk_field)

            _try(
                f"ncr_{fk_field.lower()}_unlinked",
                lambda c=col: db.query(NCR)
                    .filter(c == employee_id)
                    .update({c: None}, synchronize_session=False)
            )

    # ---- 3. Delete the employee photo file (if any) ----
    if emp.PHOTO_URL:

        try:

            old_name = emp.PHOTO_URL.rsplit("/", 1)[-1]

            old_path = _STATIC_EMPLOYEE_DIR / old_name

            if old_path.exists() and old_path.is_file():

                old_path.unlink()

        except Exception:

            pass

    # ---- 4. Finally delete the employee ----
    try:

        db.delete(emp)

        db.commit()

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                f"Could not delete employee. Some related rows "
                f"still reference this person. Detail: {exc}"
            )
        )

    return {
        "message": (
            f"Employee {emp.NAME} ({emp.EMPLOYEE_CODE}) deleted."
        ),
        "cleanup": counts
    }
