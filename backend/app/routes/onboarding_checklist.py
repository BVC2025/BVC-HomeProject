"""
Employee Onboarding — post-joining operational module.

Distinct from the pre-joining `employee_onboarding.py` (token-invite flow).
This module covers the operational steps that begin AFTER an employee has
been hired and approved:

  - Joining Checklist (aggregate progress)
  - Document Collection
  - Department / Role assignment confirmation
  - Asset Allocation (laptop, ID card, locker...)
  - Training Assignment
  - Welcome Kit Tracking

One endpoint pattern across the module:
  /onboarding/employees/{employee_id}/...   (per-employee actions)
  /onboarding/masters/...                   (HR-managed catalogues)
"""

from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin, get_current_user
from app.models.models import (
    Employee, Department, Designation,
    AssetMaster, AssetAllocation,
    TrainingProgram, TrainingAssignment,
    WelcomeKitItem, WelcomeKitIssuance,
    OnboardingChecklistItem,
    EmployeeDocument,
)


router = APIRouter(prefix="/hr-onboarding", tags=["hr-onboarding"])
# Distinct from /onboarding/* which is the customer (and old employee
# token-invite) flow. This module is post-joining operational onboarding.


# =====================================================================
# Pydantic schemas
# =====================================================================


class AssetMasterIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=1, max_length=40)
    description: Optional[str] = None
    is_active: bool = True


class AssetMasterOut(BaseModel):
    id: int
    name: str
    category: str
    description: Optional[str] = None
    is_active: bool


class AssetAllocationIn(BaseModel):
    asset_master_id: int
    serial_number: Optional[str] = None
    issued_date: Optional[date] = None
    notes: Optional[str] = None


class AssetAllocationOut(BaseModel):
    id: int
    asset_master_id: int
    asset_name: str
    asset_category: str
    serial_number: Optional[str] = None
    issued_date: Optional[date] = None
    returned_date: Optional[date] = None
    status: str
    notes: Optional[str] = None


class TrainingProgramIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None
    duration_days: int = 1
    is_mandatory: bool = False
    is_active: bool = True


class TrainingProgramOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    duration_days: int
    is_mandatory: bool
    is_active: bool


class TrainingAssignmentIn(BaseModel):
    training_program_id: int
    due_date: Optional[date] = None
    notes: Optional[str] = None


class TrainingAssignmentOut(BaseModel):
    id: int
    training_program_id: int
    training_name: str
    assigned_date: Optional[date] = None
    due_date: Optional[date] = None
    completed_date: Optional[date] = None
    status: str
    score: Optional[float] = None
    notes: Optional[str] = None


class WelcomeKitItemIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = None
    is_default: bool = True
    is_active: bool = True


class WelcomeKitItemOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    is_default: bool
    is_active: bool


class WelcomeKitIssuanceIn(BaseModel):
    welcome_kit_item_id: int
    notes: Optional[str] = None


class WelcomeKitIssuanceOut(BaseModel):
    id: int
    welcome_kit_item_id: int
    item_name: str
    issued_date: Optional[date] = None
    status: str
    notes: Optional[str] = None


class ChecklistItemOut(BaseModel):
    id: int
    item_key: str
    label: str
    category: str
    status: str
    completed_date: Optional[date] = None
    notes: Optional[str] = None
    sort_order: int


class ChecklistItemPatch(BaseModel):
    status: Optional[str] = None   # PENDING / DONE / SKIPPED
    notes: Optional[str] = None


class ChecklistSummary(BaseModel):
    employee_id: str
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    total_items: int
    done_items: int
    pending_items: int
    skipped_items: int
    completion_pct: int
    department: Optional[str] = None
    designation: Optional[str] = None
    items: List[ChecklistItemOut] = []


class OnboardingOverviewRow(BaseModel):
    employee_id: str
    employee_code: Optional[str] = None
    employee_name: str
    joining_date: Optional[date] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    total_items: int
    done_items: int
    completion_pct: int
    status: str   # NOT_STARTED / IN_PROGRESS / COMPLETE


# =====================================================================
# Service layer
# =====================================================================


DEFAULT_CHECKLIST = [
    # (item_key, label, category, sort_order)
    ("DOC_AADHAAR",       "Aadhaar card collected",        "DOC",      10),
    ("DOC_PAN",           "PAN card collected",            "DOC",      20),
    ("DOC_BANK_PROOF",    "Bank account proof collected",  "DOC",      30),
    ("DOC_OFFER_SIGNED",  "Signed offer letter received",  "DOC",      40),
    ("DEPT_ASSIGNED",     "Department assigned",           "DEPT",     50),
    ("ROLE_ASSIGNED",     "Role / designation assigned",   "ROLE",     60),
    ("MANAGER_ASSIGNED",  "Reporting manager assigned",    "OTHER",    65),
    ("ASSETS_ALLOCATED",  "Assets allocated",              "ASSET",    70),
    ("TRAINING_ASSIGNED", "Induction training assigned",   "TRAINING", 80),
    ("WELCOME_KIT",       "Welcome kit handed over",       "KIT",      90),
    ("ID_CARD_ISSUED",    "Company ID card issued",        "OTHER",   100),
    ("EMAIL_PROVISIONED", "Corporate email + access ready","OTHER",   110),
]


def _seed_default_checklist(db: Session, employee: Employee) -> None:
    """Idempotent: only inserts missing checklist rows for the employee."""
    existing_keys = {
        r.ITEM_KEY for r in
        db.query(OnboardingChecklistItem.ITEM_KEY)
          .filter(OnboardingChecklistItem.EMPLOYEE_ID == employee.ID)
          .all()
    }
    for key, label, category, sort_order in DEFAULT_CHECKLIST:
        if key in existing_keys:
            continue
        db.add(OnboardingChecklistItem(
            EMPLOYEE_ID=employee.ID,
            ITEM_KEY=key, LABEL=label, CATEGORY=category,
            STATUS="PENDING", SORT_ORDER=sort_order,
            VENDOR_ID=employee.VENDOR_ID,
        ))
    db.flush()


def _refresh_derived_items(db: Session, employee: Employee) -> None:
    """Auto-mark checklist items DONE when the underlying state proves it.

    Cheap; runs on every GET so the UI is always up to date without
    needing a cron. Only flips PENDING → DONE, never the other way."""
    items = (db.query(OnboardingChecklistItem)
             .filter(OnboardingChecklistItem.EMPLOYEE_ID == employee.ID)
             .all())
    by_key = {i.ITEM_KEY: i for i in items}

    def _mark(key: str, condition: bool):
        item = by_key.get(key)
        if not item or item.STATUS != "PENDING" or not condition:
            return
        item.STATUS = "DONE"
        item.COMPLETED_DATE = date.today()

    # DEPT / ROLE / MANAGER
    _mark("DEPT_ASSIGNED",    bool(employee.DEPARTMENT_ID))
    _mark("ROLE_ASSIGNED",    bool(employee.DESIGNATION_ID))
    _mark("MANAGER_ASSIGNED", bool(getattr(employee, "REPORTING_MANAGER_ID", None)))
    _mark("EMAIL_PROVISIONED", bool(getattr(employee, "CORPORATE_EMAIL", None)))

    # Docs — leverage existing EmployeeDocument table
    docs = (db.query(EmployeeDocument)
            .filter(EmployeeDocument.EMPLOYEE_ID == employee.ID)
            .all())
    doc_types = {(d.DOC_TYPE or "").upper() for d in docs}

    _mark("DOC_AADHAAR",    "AADHAAR" in doc_types or bool(employee.AADHAAR_NUMBER))
    _mark("DOC_PAN",        "PAN" in doc_types     or bool(employee.PAN_NUMBER))
    _mark("DOC_BANK_PROOF", "BANK" in doc_types    or bool(employee.BANK_ACCOUNT_NUMBER))

    # Assets / Training / Kit — DONE once at least one row exists
    has_asset = (db.query(AssetAllocation)
                 .filter(AssetAllocation.EMPLOYEE_ID == employee.ID,
                         AssetAllocation.STATUS == "ISSUED").count() > 0)
    _mark("ASSETS_ALLOCATED", has_asset)

    has_training = (db.query(TrainingAssignment)
                    .filter(TrainingAssignment.EMPLOYEE_ID == employee.ID).count() > 0)
    _mark("TRAINING_ASSIGNED", has_training)

    has_kit = (db.query(WelcomeKitIssuance)
               .filter(WelcomeKitIssuance.EMPLOYEE_ID == employee.ID,
                       WelcomeKitIssuance.STATUS == "ISSUED").count() > 0)
    _mark("WELCOME_KIT", has_kit)

    db.flush()


def _require_employee(db: Session, emp_id: str) -> Employee:
    emp = (db.query(Employee)
           .filter((Employee.ID == emp_id) | (Employee.EMPLOYEE_CODE == emp_id))
           .first())
    if not emp:
        raise HTTPException(404, "Employee not found")
    return emp


def _bool_int(v) -> int:
    return 1 if v else 0


# =====================================================================
# Master: Assets
# =====================================================================


@router.get("/masters/assets", response_model=List[AssetMasterOut])
def list_asset_masters(db: Session = Depends(get_db),
                       user: dict = Depends(get_current_user)):
    rows = (db.query(AssetMaster)
            .filter(AssetMaster.VENDOR_ID == user.get("vendor_id", 1))
            .order_by(AssetMaster.CATEGORY, AssetMaster.NAME).all())
    return [AssetMasterOut(id=r.ID, name=r.NAME, category=r.CATEGORY,
                           description=r.DESCRIPTION, is_active=bool(r.IS_ACTIVE))
            for r in rows]


@router.post("/masters/assets", response_model=AssetMasterOut, status_code=201)
def create_asset_master(payload: AssetMasterIn,
                        db: Session = Depends(get_db),
                        user: dict = Depends(get_current_admin)):
    row = AssetMaster(
        NAME=payload.name, CATEGORY=payload.category.upper(),
        DESCRIPTION=payload.description, IS_ACTIVE=_bool_int(payload.is_active),
        VENDOR_ID=user.get("vendor_id", 1),
    )
    db.add(row); db.commit(); db.refresh(row)
    return AssetMasterOut(id=row.ID, name=row.NAME, category=row.CATEGORY,
                          description=row.DESCRIPTION, is_active=bool(row.IS_ACTIVE))


@router.delete("/masters/assets/{asset_id}", status_code=204)
def delete_asset_master(asset_id: int,
                        db: Session = Depends(get_db),
                        user: dict = Depends(get_current_admin)):
    row = db.get(AssetMaster, asset_id)
    if not row:
        raise HTTPException(404, "Asset not found")
    row.IS_ACTIVE = 0  # soft delete keeps historical allocations valid
    db.commit()


# =====================================================================
# Master: Training programs
# =====================================================================


@router.get("/masters/trainings", response_model=List[TrainingProgramOut])
def list_training_programs(db: Session = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    rows = (db.query(TrainingProgram)
            .filter(TrainingProgram.VENDOR_ID == user.get("vendor_id", 1))
            .order_by(TrainingProgram.NAME).all())
    return [TrainingProgramOut(id=r.ID, name=r.NAME, description=r.DESCRIPTION,
                               duration_days=r.DURATION_DAYS,
                               is_mandatory=bool(r.IS_MANDATORY),
                               is_active=bool(r.IS_ACTIVE))
            for r in rows]


@router.post("/masters/trainings", response_model=TrainingProgramOut, status_code=201)
def create_training_program(payload: TrainingProgramIn,
                            db: Session = Depends(get_db),
                            user: dict = Depends(get_current_admin)):
    row = TrainingProgram(
        NAME=payload.name, DESCRIPTION=payload.description,
        DURATION_DAYS=payload.duration_days,
        IS_MANDATORY=_bool_int(payload.is_mandatory),
        IS_ACTIVE=_bool_int(payload.is_active),
        VENDOR_ID=user.get("vendor_id", 1),
    )
    db.add(row); db.commit(); db.refresh(row)
    return TrainingProgramOut(id=row.ID, name=row.NAME, description=row.DESCRIPTION,
                              duration_days=row.DURATION_DAYS,
                              is_mandatory=bool(row.IS_MANDATORY),
                              is_active=bool(row.IS_ACTIVE))


@router.delete("/masters/trainings/{tid}", status_code=204)
def delete_training_program(tid: int,
                            db: Session = Depends(get_db),
                            user: dict = Depends(get_current_admin)):
    row = db.get(TrainingProgram, tid)
    if not row:
        raise HTTPException(404, "Training program not found")
    row.IS_ACTIVE = 0
    db.commit()


# =====================================================================
# Master: Welcome kit items
# =====================================================================


@router.get("/masters/kit", response_model=List[WelcomeKitItemOut])
def list_kit_items(db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    rows = (db.query(WelcomeKitItem)
            .filter(WelcomeKitItem.VENDOR_ID == user.get("vendor_id", 1))
            .order_by(WelcomeKitItem.NAME).all())
    return [WelcomeKitItemOut(id=r.ID, name=r.NAME, description=r.DESCRIPTION,
                              is_default=bool(r.IS_DEFAULT),
                              is_active=bool(r.IS_ACTIVE))
            for r in rows]


@router.post("/masters/kit", response_model=WelcomeKitItemOut, status_code=201)
def create_kit_item(payload: WelcomeKitItemIn,
                    db: Session = Depends(get_db),
                    user: dict = Depends(get_current_admin)):
    row = WelcomeKitItem(
        NAME=payload.name, DESCRIPTION=payload.description,
        IS_DEFAULT=_bool_int(payload.is_default),
        IS_ACTIVE=_bool_int(payload.is_active),
        VENDOR_ID=user.get("vendor_id", 1),
    )
    db.add(row); db.commit(); db.refresh(row)
    return WelcomeKitItemOut(id=row.ID, name=row.NAME, description=row.DESCRIPTION,
                             is_default=bool(row.IS_DEFAULT),
                             is_active=bool(row.IS_ACTIVE))


@router.delete("/masters/kit/{kid}", status_code=204)
def delete_kit_item(kid: int,
                    db: Session = Depends(get_db),
                    user: dict = Depends(get_current_admin)):
    row = db.get(WelcomeKitItem, kid)
    if not row:
        raise HTTPException(404, "Item not found")
    row.IS_ACTIVE = 0
    db.commit()


# =====================================================================
# Per-employee: checklist
# =====================================================================


@router.get("/employees/{emp_id}/checklist", response_model=ChecklistSummary)
def get_employee_checklist(emp_id: str,
                           db: Session = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    emp = _require_employee(db, emp_id)
    _seed_default_checklist(db, emp)
    _refresh_derived_items(db, emp)
    db.commit()

    items = (db.query(OnboardingChecklistItem)
             .filter(OnboardingChecklistItem.EMPLOYEE_ID == emp.ID)
             .order_by(OnboardingChecklistItem.SORT_ORDER.asc()).all())

    total   = len(items)
    done    = sum(1 for i in items if i.STATUS == "DONE")
    skipped = sum(1 for i in items if i.STATUS == "SKIPPED")
    pending = total - done - skipped
    pct     = int(round((done + skipped) * 100 / total)) if total else 0

    dept_name = None
    if emp.DEPARTMENT_ID:
        d = db.get(Department, emp.DEPARTMENT_ID)
        dept_name = d.NAME if d else None
    desig_name = None
    if emp.DESIGNATION_ID:
        x = db.get(Designation, emp.DESIGNATION_ID)
        desig_name = x.TITLE if x else None

    return ChecklistSummary(
        employee_id=emp.ID,
        employee_code=emp.EMPLOYEE_CODE,
        employee_name=emp.NAME,
        total_items=total, done_items=done,
        pending_items=pending, skipped_items=skipped,
        completion_pct=pct,
        department=dept_name, designation=desig_name,
        items=[ChecklistItemOut(
            id=i.ID, item_key=i.ITEM_KEY, label=i.LABEL,
            category=i.CATEGORY, status=i.STATUS,
            completed_date=i.COMPLETED_DATE,
            notes=i.NOTES, sort_order=i.SORT_ORDER
        ) for i in items],
    )


@router.patch("/employees/{emp_id}/checklist/{item_id}", response_model=ChecklistItemOut)
def update_checklist_item(emp_id: str, item_id: int,
                          patch: ChecklistItemPatch,
                          db: Session = Depends(get_db),
                          user: dict = Depends(get_current_admin)):
    emp = _require_employee(db, emp_id)
    item = db.get(OnboardingChecklistItem, item_id)
    if not item or item.EMPLOYEE_ID != emp.ID:
        raise HTTPException(404, "Checklist item not found")

    if patch.status:
        s = patch.status.upper()
        if s not in {"PENDING", "DONE", "SKIPPED"}:
            raise HTTPException(400, "Invalid status")
        item.STATUS = s
        if s == "DONE":
            item.COMPLETED_DATE = date.today()
            item.COMPLETED_BY_ID = user.get("employee_id")
        else:
            item.COMPLETED_DATE = None
    if patch.notes is not None:
        item.NOTES = patch.notes
    db.commit(); db.refresh(item)
    return ChecklistItemOut(
        id=item.ID, item_key=item.ITEM_KEY, label=item.LABEL,
        category=item.CATEGORY, status=item.STATUS,
        completed_date=item.COMPLETED_DATE,
        notes=item.NOTES, sort_order=item.SORT_ORDER
    )


# =====================================================================
# Per-employee: asset allocations
# =====================================================================


@router.get("/employees/{emp_id}/assets", response_model=List[AssetAllocationOut])
def list_employee_assets(emp_id: str,
                         db: Session = Depends(get_db),
                         user: dict = Depends(get_current_user)):
    emp = _require_employee(db, emp_id)
    rows = (db.query(AssetAllocation, AssetMaster)
            .join(AssetMaster, AssetAllocation.ASSET_MASTER_ID == AssetMaster.ID)
            .filter(AssetAllocation.EMPLOYEE_ID == emp.ID)
            .order_by(AssetAllocation.CREATED_AT.desc()).all())
    return [AssetAllocationOut(
        id=a.ID, asset_master_id=m.ID, asset_name=m.NAME,
        asset_category=m.CATEGORY, serial_number=a.SERIAL_NUMBER,
        issued_date=a.ISSUED_DATE, returned_date=a.RETURNED_DATE,
        status=a.STATUS, notes=a.NOTES,
    ) for a, m in rows]


@router.post("/employees/{emp_id}/assets",
             response_model=AssetAllocationOut, status_code=201)
def allocate_asset(emp_id: str, payload: AssetAllocationIn,
                   db: Session = Depends(get_db),
                   user: dict = Depends(get_current_admin)):
    emp = _require_employee(db, emp_id)
    master = db.get(AssetMaster, payload.asset_master_id)
    if not master or master.VENDOR_ID != emp.VENDOR_ID:
        raise HTTPException(400, "Invalid asset_master_id")
    row = AssetAllocation(
        EMPLOYEE_ID=emp.ID, ASSET_MASTER_ID=master.ID,
        SERIAL_NUMBER=payload.serial_number,
        ISSUED_DATE=payload.issued_date or date.today(),
        STATUS="ISSUED", NOTES=payload.notes,
        ISSUED_BY_ID=user.get("employee_id"),
        VENDOR_ID=emp.VENDOR_ID,
    )
    db.add(row); db.commit(); db.refresh(row)
    return AssetAllocationOut(
        id=row.ID, asset_master_id=master.ID, asset_name=master.NAME,
        asset_category=master.CATEGORY, serial_number=row.SERIAL_NUMBER,
        issued_date=row.ISSUED_DATE, returned_date=row.RETURNED_DATE,
        status=row.STATUS, notes=row.NOTES,
    )


@router.post("/employees/{emp_id}/assets/{alloc_id}/return")
def return_asset(emp_id: str, alloc_id: int,
                 db: Session = Depends(get_db),
                 user: dict = Depends(get_current_admin)):
    emp = _require_employee(db, emp_id)
    row = db.get(AssetAllocation, alloc_id)
    if not row or row.EMPLOYEE_ID != emp.ID:
        raise HTTPException(404, "Allocation not found")
    row.STATUS = "RETURNED"
    row.RETURNED_DATE = date.today()
    db.commit()
    return {"ok": True}


# =====================================================================
# Per-employee: training assignments
# =====================================================================


@router.get("/employees/{emp_id}/trainings",
            response_model=List[TrainingAssignmentOut])
def list_employee_trainings(emp_id: str,
                            db: Session = Depends(get_db),
                            user: dict = Depends(get_current_user)):
    emp = _require_employee(db, emp_id)
    rows = (db.query(TrainingAssignment, TrainingProgram)
            .join(TrainingProgram,
                  TrainingAssignment.TRAINING_PROGRAM_ID == TrainingProgram.ID)
            .filter(TrainingAssignment.EMPLOYEE_ID == emp.ID)
            .order_by(TrainingAssignment.ASSIGNED_DATE.desc()).all())
    return [TrainingAssignmentOut(
        id=t.ID, training_program_id=p.ID, training_name=p.NAME,
        assigned_date=t.ASSIGNED_DATE, due_date=t.DUE_DATE,
        completed_date=t.COMPLETED_DATE, status=t.STATUS,
        score=t.SCORE, notes=t.NOTES,
    ) for t, p in rows]


@router.post("/employees/{emp_id}/trainings",
             response_model=TrainingAssignmentOut, status_code=201)
def assign_training(emp_id: str, payload: TrainingAssignmentIn,
                    db: Session = Depends(get_db),
                    user: dict = Depends(get_current_admin)):
    emp = _require_employee(db, emp_id)
    prog = db.get(TrainingProgram, payload.training_program_id)
    if not prog or prog.VENDOR_ID != emp.VENDOR_ID:
        raise HTTPException(400, "Invalid training_program_id")
    existing = (db.query(TrainingAssignment)
                .filter(TrainingAssignment.EMPLOYEE_ID == emp.ID,
                        TrainingAssignment.TRAINING_PROGRAM_ID == prog.ID,
                        TrainingAssignment.STATUS.in_(["ASSIGNED", "IN_PROGRESS"]))
                .first())
    if existing:
        raise HTTPException(409, "Already assigned and not yet completed")
    row = TrainingAssignment(
        EMPLOYEE_ID=emp.ID, TRAINING_PROGRAM_ID=prog.ID,
        ASSIGNED_DATE=date.today(), DUE_DATE=payload.due_date,
        STATUS="ASSIGNED", NOTES=payload.notes,
        ASSIGNED_BY_ID=user.get("employee_id"),
        VENDOR_ID=emp.VENDOR_ID,
    )
    db.add(row); db.commit(); db.refresh(row)
    return TrainingAssignmentOut(
        id=row.ID, training_program_id=prog.ID, training_name=prog.NAME,
        assigned_date=row.ASSIGNED_DATE, due_date=row.DUE_DATE,
        completed_date=row.COMPLETED_DATE, status=row.STATUS,
        score=row.SCORE, notes=row.NOTES,
    )


@router.post("/employees/{emp_id}/trainings/{tid}/complete")
def complete_training(emp_id: str, tid: int,
                      score: Optional[float] = None,
                      db: Session = Depends(get_db),
                      user: dict = Depends(get_current_admin)):
    emp = _require_employee(db, emp_id)
    row = db.get(TrainingAssignment, tid)
    if not row or row.EMPLOYEE_ID != emp.ID:
        raise HTTPException(404, "Assignment not found")
    row.STATUS = "COMPLETED"
    row.COMPLETED_DATE = date.today()
    if score is not None:
        row.SCORE = score
    db.commit()
    return {"ok": True}


# =====================================================================
# Per-employee: welcome kit
# =====================================================================


@router.get("/employees/{emp_id}/kit",
            response_model=List[WelcomeKitIssuanceOut])
def list_employee_kit(emp_id: str,
                      db: Session = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    emp = _require_employee(db, emp_id)
    rows = (db.query(WelcomeKitIssuance, WelcomeKitItem)
            .join(WelcomeKitItem,
                  WelcomeKitIssuance.WELCOME_KIT_ITEM_ID == WelcomeKitItem.ID)
            .filter(WelcomeKitIssuance.EMPLOYEE_ID == emp.ID)
            .order_by(WelcomeKitItem.NAME).all())
    return [WelcomeKitIssuanceOut(
        id=i.ID, welcome_kit_item_id=m.ID, item_name=m.NAME,
        issued_date=i.ISSUED_DATE, status=i.STATUS, notes=i.NOTES,
    ) for i, m in rows]


@router.post("/employees/{emp_id}/kit/seed-defaults",
             response_model=List[WelcomeKitIssuanceOut])
def seed_default_kit(emp_id: str,
                     db: Session = Depends(get_db),
                     user: dict = Depends(get_current_admin)):
    """Auto-create PENDING issuance rows for every default kit item not yet
    on this employee's list. Idempotent."""
    emp = _require_employee(db, emp_id)
    defaults = (db.query(WelcomeKitItem)
                .filter(WelcomeKitItem.VENDOR_ID == emp.VENDOR_ID,
                        WelcomeKitItem.IS_ACTIVE == 1,
                        WelcomeKitItem.IS_DEFAULT == 1).all())
    existing_ids = {
        r.WELCOME_KIT_ITEM_ID for r in
        db.query(WelcomeKitIssuance.WELCOME_KIT_ITEM_ID)
          .filter(WelcomeKitIssuance.EMPLOYEE_ID == emp.ID).all()
    }
    for item in defaults:
        if item.ID in existing_ids:
            continue
        db.add(WelcomeKitIssuance(
            EMPLOYEE_ID=emp.ID, WELCOME_KIT_ITEM_ID=item.ID,
            STATUS="PENDING", VENDOR_ID=emp.VENDOR_ID,
        ))
    db.commit()
    return list_employee_kit(emp_id, db, user)


@router.post("/employees/{emp_id}/kit",
             response_model=WelcomeKitIssuanceOut, status_code=201)
def issue_kit_item(emp_id: str, payload: WelcomeKitIssuanceIn,
                   db: Session = Depends(get_db),
                   user: dict = Depends(get_current_admin)):
    emp = _require_employee(db, emp_id)
    item = db.get(WelcomeKitItem, payload.welcome_kit_item_id)
    if not item or item.VENDOR_ID != emp.VENDOR_ID:
        raise HTTPException(400, "Invalid welcome_kit_item_id")
    existing = (db.query(WelcomeKitIssuance)
                .filter(WelcomeKitIssuance.EMPLOYEE_ID == emp.ID,
                        WelcomeKitIssuance.WELCOME_KIT_ITEM_ID == item.ID)
                .first())
    if existing:
        existing.STATUS = "ISSUED"
        existing.ISSUED_DATE = date.today()
        existing.ISSUED_BY_ID = user.get("employee_id")
        if payload.notes is not None:
            existing.NOTES = payload.notes
        db.commit(); db.refresh(existing)
        row = existing
    else:
        row = WelcomeKitIssuance(
            EMPLOYEE_ID=emp.ID, WELCOME_KIT_ITEM_ID=item.ID,
            ISSUED_DATE=date.today(), STATUS="ISSUED",
            NOTES=payload.notes,
            ISSUED_BY_ID=user.get("employee_id"),
            VENDOR_ID=emp.VENDOR_ID,
        )
        db.add(row); db.commit(); db.refresh(row)
    return WelcomeKitIssuanceOut(
        id=row.ID, welcome_kit_item_id=item.ID, item_name=item.NAME,
        issued_date=row.ISSUED_DATE, status=row.STATUS, notes=row.NOTES,
    )


# =====================================================================
# Overview: list every active employee with their onboarding progress
# =====================================================================


@router.get("/overview", response_model=List[OnboardingOverviewRow])
def onboarding_overview(only_in_progress: bool = Query(False),
                        db: Session = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    vendor_id = user.get("vendor_id", 1)
    emps = (db.query(Employee)
            .filter(Employee.VENDOR_ID == vendor_id,
                    Employee.STATUS == "ACTIVE")
            # NULLS LAST emulation — MySQL doesn't support the keyword.
            # IS NULL produces 0/1 and sorts FALSE(0)=non-null first.
            .order_by(Employee.JOINING_DATE.is_(None),
                      Employee.JOINING_DATE.desc()).all())

    rows: List[OnboardingOverviewRow] = []
    for emp in emps:
        _seed_default_checklist(db, emp)
        _refresh_derived_items(db, emp)

        items = (db.query(OnboardingChecklistItem)
                 .filter(OnboardingChecklistItem.EMPLOYEE_ID == emp.ID).all())
        total = len(items)
        done  = sum(1 for i in items if i.STATUS in ("DONE", "SKIPPED"))
        pct   = int(round(done * 100 / total)) if total else 0
        status = ("COMPLETE" if pct == 100 else
                  "NOT_STARTED" if done == 0 else "IN_PROGRESS")

        if only_in_progress and status == "COMPLETE":
            continue

        dept_name = None
        if emp.DEPARTMENT_ID:
            d = db.get(Department, emp.DEPARTMENT_ID)
            dept_name = d.NAME if d else None
        desig_name = None
        if emp.DESIGNATION_ID:
            x = db.get(Designation, emp.DESIGNATION_ID)
            desig_name = x.TITLE if x else None

        rows.append(OnboardingOverviewRow(
            employee_id=emp.ID, employee_code=emp.EMPLOYEE_CODE,
            employee_name=emp.NAME, joining_date=emp.JOINING_DATE,
            department=dept_name, designation=desig_name,
            total_items=total, done_items=done,
            completion_pct=pct, status=status,
        ))
    db.commit()
    return rows


# =====================================================================
# AUTO-ONBOARDING PIPELINE
#
# The whole point: HR shouldn't manually seed each employee's onboarding
# artifacts. When someone joins, everything should already be in place.
#
# The four endpoints below are the automation primitives:
#
#   PATCH  /employees/{id}/reporting-manager       assign / change manager
#   POST   /employees/{id}/provision-email         auto-generate CORPORATE_EMAIL
#   POST   /employees/{id}/seed-mandatory-trainings  bulk-assign IS_MANDATORY=1
#   POST   /employees/{id}/auto-onboard             the master orchestrator
#
# `auto-onboard` runs everything idempotently — safe to re-run at any time
# for existing employees; safe to call from an event hook when a new
# Employee row is created.
# =====================================================================


class ReportingManagerIn(BaseModel):
    reporting_manager_id: Optional[str] = None
    # Nullable → clears the manager if the caller passes null / omits.


class EmailProvisionResult(BaseModel):
    corporate_email: str
    was_generated: bool
    welcome_email_sent: bool
    welcome_email_message: Optional[str] = None


class AutoOnboardResult(BaseModel):
    employee_id: str
    checklist_seeded: bool
    kit_seeded_count: int
    trainings_seeded_count: int
    email_provisioned: bool
    corporate_email: Optional[str] = None
    already_present: List[str] = []
    # Names of steps that were already done, for audit visibility.


def _slugify(text: str) -> str:
    """firstname.lastname (lowercased, ASCII only, no doubled dots)."""

    import re, unicodedata

    if not text:

        return ""

    # Strip diacritics, keep ASCII letters + spaces
    norm = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch))
    lowered = ascii_only.lower()

    # Replace anything that isn't [a-z0-9] with space, then collapse
    cleaned = re.sub(r"[^a-z0-9]+", " ", lowered).strip()

    parts = [p for p in cleaned.split() if p]

    if not parts:

        return ""

    return ".".join(parts)


def _generate_corporate_email(db: Session, employee: Employee) -> str:
    """firstname.lastname@bvc24.com, with a numeric suffix on collision."""

    import os

    domain = os.getenv("CORPORATE_EMAIL_DOMAIN", "bvc24.com").strip() or "bvc24.com"

    local = _slugify(employee.NAME or "")

    if not local:

        # Fall back to the employee code so we still get a unique address
        local = (employee.EMPLOYEE_CODE or f"emp{employee.ID}").lower().replace("_", ".")

    candidate = f"{local}@{domain}"

    # Collision check — append .1, .2, ... until unique
    suffix = 1

    while db.query(Employee).filter(
        Employee.CORPORATE_EMAIL == candidate,
        Employee.ID != employee.ID,
    ).first() is not None:

        candidate = f"{local}.{suffix}@{domain}"
        suffix += 1

    return candidate


def _send_welcome_email(employee: Employee, corporate_email: str) -> (bool, str):
    """Best-effort welcome email to the candidate's personal inbox with
    their newly-assigned corporate credentials. Returns (ok, message)."""

    if not employee.EMAIL:

        return False, "No personal email on file — skipped."

    try:

        from app.services.email_service import send_alert_email

        html = f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#C8102E,#8B0B1F);color:white;padding:24px 28px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;opacity:0.9;">BVC24 · WELCOME ABOARD</div>
      <h1 style="margin:6px 0 0;font-size:22px;">Welcome to Bharath Vending Corporation, {employee.NAME}!</h1>
    </div>
    <div style="padding:26px 28px;color:#0f172a;line-height:1.55;">
      <p>Hello {employee.NAME},</p>
      <p>We're excited to have you on board. Your onboarding is now underway — HR will guide you through the joining checklist over the next few days.</p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;margin:18px 0;">
        <div style="font-size:11px;color:#7A1022;font-weight:700;letter-spacing:1.5px;margin-bottom:6px;">YOUR CORPORATE EMAIL</div>
        <div style="font-size:14px;"><b>{corporate_email}</b></div>
        <div style="font-size:12px;color:#64748b;margin-top:8px;">
          Access details will be shared separately once your IT setup is provisioned.
        </div>
      </div>
      <p>In the meantime, please make sure your documents (Aadhaar, PAN, bank proof) are ready — HR may request scans as part of the checklist.</p>
      <p style="margin-top:24px;">Welcome again,<br><b>BVC24 HR Team</b></p>
    </div>
    <div style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;text-align:center;">
      Bharath Vending Corporation · Chennai, Tamil Nadu · www.bvc24.in
    </div>
  </div>
</body>
</html>
"""

        ok, msg = send_alert_email(
            "Welcome to BVC24 — your corporate email",
            html,
            recipient=employee.EMAIL,
        )

        return bool(ok), (msg or "")

    except Exception as exc:

        return False, f"send failed: {exc}"


@router.patch("/employees/{emp_id}/reporting-manager")
def assign_reporting_manager(
    emp_id: str,
    payload: ReportingManagerIn,
    db: Session = Depends(get_db),
    _admin: Employee = Depends(get_current_admin),
):
    """Assign or clear a reporting manager for an employee.

    Rejects self-manager (can't report to yourself) and rejects circular
    chains (A→B, B→A). Auto-derives the MANAGER_ASSIGNED checklist item
    on the next fetch."""

    emp = _require_employee(db, emp_id)

    mgr_id = payload.reporting_manager_id

    if mgr_id:

        if mgr_id == emp.ID:

            raise HTTPException(
                status_code=400,
                detail="An employee cannot report to themselves.",
            )

        mgr = db.query(Employee).filter(Employee.ID == mgr_id).first()

        if mgr is None:

            raise HTTPException(
                status_code=404,
                detail=f"Manager {mgr_id} not found.",
            )

        # Circular-chain guard — walk up the manager chain from mgr and
        # make sure emp doesn't appear.
        seen = set()

        cursor = mgr

        while cursor is not None and cursor.REPORTING_MANAGER_ID:

            if cursor.REPORTING_MANAGER_ID in seen:

                break    # existing loop somewhere; stop walking

            seen.add(cursor.REPORTING_MANAGER_ID)

            if cursor.REPORTING_MANAGER_ID == emp.ID:

                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Circular reporting chain detected — assigning "
                        f"{mgr.NAME} would make the reporting graph a cycle."
                    ),
                )

            cursor = db.query(Employee).filter(
                Employee.ID == cursor.REPORTING_MANAGER_ID
            ).first()

    emp.REPORTING_MANAGER_ID = mgr_id or None

    db.commit()
    db.refresh(emp)

    # Refresh checklist so MANAGER_ASSIGNED flips DONE immediately.
    _seed_default_checklist(db, emp)
    _refresh_derived_items(db, emp)
    db.commit()

    return {
        "employee_id": emp.ID,
        "reporting_manager_id": emp.REPORTING_MANAGER_ID,
    }


@router.post("/employees/{emp_id}/provision-email", response_model=EmailProvisionResult)
def provision_corporate_email(
    emp_id: str,
    db: Session = Depends(get_db),
    _admin: Employee = Depends(get_current_admin),
):
    """Auto-generate a corporate email for the employee, save it, and
    send a welcome email to their personal inbox with the new address.

    Idempotent: if CORPORATE_EMAIL is already set, returns it unchanged
    without sending another welcome email."""

    emp = _require_employee(db, emp_id)

    was_generated = False

    if not (emp.CORPORATE_EMAIL or "").strip():

        emp.CORPORATE_EMAIL = _generate_corporate_email(db, emp)
        db.commit()
        db.refresh(emp)
        was_generated = True

    # Auto-derive EMAIL_PROVISIONED on the checklist
    _seed_default_checklist(db, emp)
    _refresh_derived_items(db, emp)
    db.commit()

    welcome_ok = False
    welcome_msg = None

    if was_generated:

        welcome_ok, welcome_msg = _send_welcome_email(emp, emp.CORPORATE_EMAIL)

    return EmailProvisionResult(
        corporate_email=emp.CORPORATE_EMAIL,
        was_generated=was_generated,
        welcome_email_sent=welcome_ok,
        welcome_email_message=welcome_msg,
    )


@router.post("/employees/{emp_id}/seed-mandatory-trainings")
def seed_mandatory_trainings(
    emp_id: str,
    db: Session = Depends(get_db),
    _admin: Employee = Depends(get_current_admin),
):
    """Bulk-assign every IS_MANDATORY=1 TrainingProgram in the employee's
    vendor scope. Idempotent — skips programs that already have an
    assignment row for this employee."""

    emp = _require_employee(db, emp_id)

    programs = (
        db.query(TrainingProgram)
        .filter(
            TrainingProgram.IS_MANDATORY == 1,
            TrainingProgram.IS_ACTIVE == 1,
            TrainingProgram.VENDOR_ID == emp.VENDOR_ID,
        )
        .all()
    )

    existing = {
        r.TRAINING_PROGRAM_ID for r in
        db.query(TrainingAssignment.TRAINING_PROGRAM_ID)
        .filter(TrainingAssignment.EMPLOYEE_ID == emp.ID)
        .all()
    }

    created = 0

    for prog in programs:

        if prog.ID in existing:

            continue

        db.add(TrainingAssignment(
            EMPLOYEE_ID=emp.ID,
            TRAINING_PROGRAM_ID=prog.ID,
            ASSIGNED_DATE=date.today(),
            STATUS="ASSIGNED",
            VENDOR_ID=emp.VENDOR_ID,
        ))

        created += 1

    db.commit()

    # Derive TRAINING_ASSIGNED checklist DONE
    _seed_default_checklist(db, emp)
    _refresh_derived_items(db, emp)
    db.commit()

    return {
        "employee_id": emp.ID,
        "programs_available": len(programs),
        "assignments_created": created,
        "assignments_already_present": len(programs) - created,
    }


def _seed_default_kit(db: Session, employee: Employee) -> int:
    """Internal: create WelcomeKitIssuance rows for every IS_DEFAULT=1 kit
    item that isn't already issued to this employee. Returns count created."""

    items = (
        db.query(WelcomeKitItem)
        .filter(
            WelcomeKitItem.IS_DEFAULT == 1,
            WelcomeKitItem.IS_ACTIVE == 1,
            WelcomeKitItem.VENDOR_ID == employee.VENDOR_ID,
        )
        .all()
    )

    existing = {
        r.WELCOME_KIT_ITEM_ID for r in
        db.query(WelcomeKitIssuance.WELCOME_KIT_ITEM_ID)
        .filter(WelcomeKitIssuance.EMPLOYEE_ID == employee.ID)
        .all()
    }

    created = 0

    for it in items:

        if it.ID in existing:

            continue

        db.add(WelcomeKitIssuance(
            EMPLOYEE_ID=employee.ID,
            WELCOME_KIT_ITEM_ID=it.ID,
            STATUS="PENDING",
            VENDOR_ID=employee.VENDOR_ID,
        ))

        created += 1

    return created


@router.post("/employees/{emp_id}/auto-onboard", response_model=AutoOnboardResult)
def auto_onboard(
    emp_id: str,
    db: Session = Depends(get_db),
    _admin: Employee = Depends(get_current_admin),
):
    """Master orchestrator — runs everything an ERP should do the moment
    an employee is hired:

      1. Seed the joining checklist (11 default items)
      2. Seed the default welcome-kit items as PENDING issuances
      3. Assign every mandatory training program
      4. Provision a corporate email + send welcome email to personal inbox

    Idempotent: every step is safe to re-run. Steps already completed are
    reported in `already_present` for audit visibility.
    """

    emp = _require_employee(db, emp_id)

    already: List[str] = []

    # 1. Checklist
    pre_count = (
        db.query(OnboardingChecklistItem)
        .filter(OnboardingChecklistItem.EMPLOYEE_ID == emp.ID)
        .count()
    )

    _seed_default_checklist(db, emp)
    db.commit()

    post_count = (
        db.query(OnboardingChecklistItem)
        .filter(OnboardingChecklistItem.EMPLOYEE_ID == emp.ID)
        .count()
    )

    checklist_seeded = post_count > pre_count

    if not checklist_seeded and pre_count > 0:

        already.append("checklist")

    # 2. Welcome kit
    kit_created = _seed_default_kit(db, emp)
    db.commit()

    if kit_created == 0:

        already.append("welcome_kit")

    # 3. Mandatory trainings
    programs = (
        db.query(TrainingProgram)
        .filter(
            TrainingProgram.IS_MANDATORY == 1,
            TrainingProgram.IS_ACTIVE == 1,
            TrainingProgram.VENDOR_ID == emp.VENDOR_ID,
        )
        .all()
    )
    existing = {
        r.TRAINING_PROGRAM_ID for r in
        db.query(TrainingAssignment.TRAINING_PROGRAM_ID)
        .filter(TrainingAssignment.EMPLOYEE_ID == emp.ID)
        .all()
    }

    trainings_created = 0

    for prog in programs:

        if prog.ID in existing:

            continue

        db.add(TrainingAssignment(
            EMPLOYEE_ID=emp.ID,
            TRAINING_PROGRAM_ID=prog.ID,
            ASSIGNED_DATE=date.today(),
            STATUS="ASSIGNED",
            VENDOR_ID=emp.VENDOR_ID,
        ))
        trainings_created += 1

    db.commit()

    if trainings_created == 0 and programs:

        already.append("mandatory_trainings")

    # 4. Corporate email
    was_generated = False

    if not (emp.CORPORATE_EMAIL or "").strip():

        emp.CORPORATE_EMAIL = _generate_corporate_email(db, emp)
        db.commit()
        db.refresh(emp)
        was_generated = True

        # Fire-and-forget welcome email — non-blocking on failure
        try:

            _send_welcome_email(emp, emp.CORPORATE_EMAIL)

        except Exception:

            pass

    else:

        already.append("corporate_email")

    # Finally refresh derived checklist items
    _refresh_derived_items(db, emp)
    db.commit()

    return AutoOnboardResult(
        employee_id=emp.ID,
        checklist_seeded=checklist_seeded,
        kit_seeded_count=kit_created,
        trainings_seeded_count=trainings_created,
        email_provisioned=was_generated,
        corporate_email=emp.CORPORATE_EMAIL,
        already_present=already,
    )
