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
    ("ASSETS_ALLOCATED",  "Assets allocated",              "ASSET",    70),
    ("TRAINING_ASSIGNED", "Induction training assigned",   "TRAINING", 80),
    ("WELCOME_KIT",       "Welcome kit handed over",       "KIT",      90),
    ("ID_CARD_ISSUED",    "Company ID card issued",        "OTHER",   100),
    ("EMAIL_PROVISIONED", "Email + system access created", "OTHER",   110),
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

    # DEPT / ROLE
    _mark("DEPT_ASSIGNED", bool(employee.DEPARTMENT_ID))
    _mark("ROLE_ASSIGNED", bool(employee.DESIGNATION_ID))

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
