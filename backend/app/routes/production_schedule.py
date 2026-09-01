"""Automatic Production Scheduling — HTTP surface for the propose ->
approve/reject -> generate workflow (production_scheduling_service.py)
and the Customer Task Timeline / Gantt chart (CustomerProjectTask read
endpoint). RBAC codes: production_schedule.view/create/approve/reject,
customer.task_timeline.view (see permission_catalogue.py)."""

import logging
from datetime import datetime, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import require
from app.models.models import (
    ProductionSchedule, CustomerProjectAssignment, CustomerProjectTask,
    Project, Customer, Lead, Employee, Department, Role,
)
from app.services.production_scheduling_service import (
    evaluate_and_propose_schedule, approve_schedule, reject_and_reschedule,
)
from app.services.employee_experience_service import classify_employee_display_level

log = logging.getLogger(__name__)

router = APIRouter(tags=["Production Scheduling"])


def _iso(v):
    return v.isoformat() if v else None


def _serialize_schedule(db: Session, schedule: ProductionSchedule) -> dict:
    assignment = db.query(CustomerProjectAssignment).filter(CustomerProjectAssignment.ID == schedule.ASSIGNMENT_ID).first()
    project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first() if assignment else None
    customer = db.query(Customer).filter(Customer.ID == assignment.CUSTOMER_ID).first() if assignment else None
    lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first() if assignment and assignment.LEAD_ID else None
    approver = db.query(Employee).filter(Employee.ID == schedule.APPROVED_BY_ID).first() if schedule.APPROVED_BY_ID else None
    rejecter = db.query(Employee).filter(Employee.ID == schedule.REJECTED_BY_ID).first() if schedule.REJECTED_BY_ID else None

    return {
        "id": schedule.ID,
        "assignment_id": schedule.ASSIGNMENT_ID,
        "customer_id": customer.ID if customer else None,
        "customer_name": customer.NAME if customer else None,
        "company_name": customer.COMPANY_NAME if customer else None,
        "project_id": project.ID if project else None,
        "project_name": project.NAME if project else None,
        "lead_id": lead.ID if lead else None,
        "quantity": assignment.QUANTITY if assignment else None,
        "status": schedule.STATUS,
        "suggested_start_date": _iso(schedule.SUGGESTED_START_DATE),
        "suggested_reason": schedule.SUGGESTED_REASON,
        "estimated_duration_days": float(schedule.ESTIMATED_DURATION_DAYS) if schedule.ESTIMATED_DURATION_DAYS is not None else None,
        "estimated_completion_date": _iso(schedule.ESTIMATED_COMPLETION_DATE),
        "chosen_start_date": _iso(schedule.CHOSEN_START_DATE),
        "approved_by_name": approver.NAME if approver else None,
        "approved_at": _iso(schedule.APPROVED_AT),
        "rejected_by_name": rejecter.NAME if rejecter else None,
        "rejected_at": _iso(schedule.REJECTED_AT),
        "reject_reason": schedule.REJECT_REASON,
        "tasks_generated_at": _iso(schedule.TASKS_GENERATED_AT),
        "created_at": _iso(schedule.CREATED_AT),
    }


@router.get("/production-schedules", dependencies=[Depends(require("production_schedule.view"))])
def list_production_schedules(
    status: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(ProductionSchedule)
    if status:
        q = q.filter(ProductionSchedule.STATUS == status.upper())
    if vendor_id:
        q = (
            q.join(CustomerProjectAssignment, CustomerProjectAssignment.ID == ProductionSchedule.ASSIGNMENT_ID)
             .filter(CustomerProjectAssignment.VENDOR_ID == vendor_id)
        )
    rows = q.order_by(ProductionSchedule.CREATED_AT.desc()).all()
    return [_serialize_schedule(db, r) for r in rows]


@router.get("/production-schedules/{schedule_id}", dependencies=[Depends(require("production_schedule.view"))])
def get_production_schedule(schedule_id: str, db: Session = Depends(get_db)):
    schedule = db.query(ProductionSchedule).filter(ProductionSchedule.ID == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Production schedule not found")
    return _serialize_schedule(db, schedule)


class GenerateScheduleBody(BaseModel):
    assignment_id: str


@router.post("/production-schedules/generate", dependencies=[Depends(require("production_schedule.create"))])
def generate_production_schedule(body: GenerateScheduleBody, db: Session = Depends(get_db)):
    """Manual (re)trigger — normally scheduling proposes itself
    automatically once the first Payment Milestone is reached; this
    exists for a one-off retry (e.g. company working hours were not
    configured yet at the time the milestone was first reached)."""
    assignment = db.query(CustomerProjectAssignment).filter(CustomerProjectAssignment.ID == body.assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    try:
        schedule = evaluate_and_propose_schedule(db, assignment)
    except Exception as e:
        log.exception("generate_production_schedule: failed for assignment %s", assignment.ID)
        raise HTTPException(status_code=400, detail=str(e))
    if not schedule:
        raise HTTPException(
            status_code=400,
            detail="Could not generate a production schedule — check that this project has configured "
                   "tasks and that company working hours are set up on the Company Profile page.",
        )
    db.commit()
    return _serialize_schedule(db, schedule)


@router.post("/production-schedules/{schedule_id}/approve", dependencies=[Depends(require("production_schedule.approve"))])
def approve_production_schedule(schedule_id: str, db: Session = Depends(get_db), admin=Depends(require("production_schedule.approve"))):
    try:
        schedule = approve_schedule(db, schedule_id, approved_by_employee_id=admin.get("employee_id"))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _serialize_schedule(db, schedule)


class RejectScheduleBody(BaseModel):
    new_start_date: str  # "YYYY-MM-DD"
    reason: Optional[str] = None


@router.post("/production-schedules/{schedule_id}/reject", dependencies=[Depends(require("production_schedule.reject"))])
def reject_production_schedule(
    schedule_id: str, body: RejectScheduleBody, db: Session = Depends(get_db),
    admin=Depends(require("production_schedule.reject")),
):
    try:
        new_date = datetime.combine(datetime.strptime(body.new_start_date, "%Y-%m-%d").date(), time(0, 0))
    except ValueError:
        raise HTTPException(status_code=400, detail="new_start_date must be in YYYY-MM-DD format")

    try:
        schedule = reject_and_reschedule(
            db, schedule_id, new_date, rejected_by_employee_id=admin.get("employee_id"), reason=body.reason,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _serialize_schedule(db, schedule)


# ---- Customer Task Timeline / Gantt chart ---------------------------------

def _serialize_task(db: Session, t: CustomerProjectTask, dept_role_cache: dict) -> dict:
    task_template = t.task_template
    project = task_template.project if task_template else None
    assignment = t.assignment
    customer = assignment.customer if assignment else None
    employee = t.employee

    dept_name = role_name = None
    if employee:
        dept_name = dept_role_cache.get(("dept", employee.DEPARTMENT_ID)) if employee.DEPARTMENT_ID else None
        role_name = dept_role_cache.get(("role", employee.ROLE_ID)) if employee.ROLE_ID else None

    return {
        "id": t.ID,
        "assignment_id": t.ASSIGNMENT_ID,
        "customer_id": customer.ID if customer else None,
        "customer_name": customer.NAME if customer else None,
        "project_id": project.ID if project else None,
        "project_name": project.NAME if project else None,
        "task_template_id": t.TASK_TEMPLATE_ID,
        "task_name": task_template.NAME if task_template else None,
        "task_group_name": task_template.task_group.NAME if task_template and task_template.task_group else None,
        "task_scope": task_template.TASK_SCOPE if task_template else None,
        "project_unit_number": t.PROJECT_UNIT_NUMBER,
        "planned_start_date": _iso(t.PLANNED_START_DATE),
        "due_date": _iso(t.DUE_DATE),
        "actual_start_date": _iso(t.ACTUAL_START_DATE),
        "completed_date": _iso(t.COMPLETED_DATE),
        "estimated_hours": float(t.ESTIMATED_HOURS) if t.ESTIMATED_HOURS is not None else None,
        "estimated_days": t.ESTIMATED_DAYS,
        "status": t.STATUS,
        "extend_count": t.EXTEND_COUNT,
        "employee_id": t.EMPLOYEE_ID,
        "employee_name": employee.NAME if employee else None,
        "employee_code": employee.EMPLOYEE_CODE if employee else None,
        "department_id": employee.DEPARTMENT_ID if employee else None,
        "department_name": dept_name,
        "role_id": employee.ROLE_ID if employee else None,
        "role_name": role_name,
        # Display-only — reflects standing among today's active
        # (department, role) peers, which can differ from the pool that
        # existed at the moment this employee was actually matched to
        # this task. Never used as a matching input.
        "employee_experience_level": classify_employee_display_level(db, employee) if employee else None,
    }


@router.get("/customer-project-tasks", dependencies=[Depends(require("customer.task_timeline.view"))])
def list_customer_project_tasks(
    assignment_id: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    employee_id: Optional[str] = Query(None),
    department_id: Optional[int] = Query(None),
    role_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    project_unit_number: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(CustomerProjectTask)

    if assignment_id:
        q = q.filter(CustomerProjectTask.ASSIGNMENT_ID == assignment_id)
    if customer_id or project_id:
        q = q.join(CustomerProjectAssignment, CustomerProjectAssignment.ID == CustomerProjectTask.ASSIGNMENT_ID)
        if customer_id:
            q = q.filter(CustomerProjectAssignment.CUSTOMER_ID == customer_id)
        if project_id:
            q = q.filter(CustomerProjectAssignment.PROJECT_ID == project_id)
    if employee_id:
        q = q.filter(CustomerProjectTask.EMPLOYEE_ID == employee_id)
    if status:
        q = q.filter(CustomerProjectTask.STATUS == status.upper())
    if project_unit_number is not None:
        q = q.filter(CustomerProjectTask.PROJECT_UNIT_NUMBER == project_unit_number)
    if date_from:
        q = q.filter(CustomerProjectTask.DUE_DATE >= datetime.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        q = q.filter(CustomerProjectTask.PLANNED_START_DATE <= datetime.strptime(date_to, "%Y-%m-%d"))
    if department_id or role_id:
        q = q.join(Employee, Employee.ID == CustomerProjectTask.EMPLOYEE_ID)
        if department_id:
            q = q.filter(Employee.DEPARTMENT_ID == department_id)
        if role_id:
            q = q.filter(Employee.ROLE_ID == role_id)

    rows = q.order_by(CustomerProjectTask.PLANNED_START_DATE).all()

    dept_ids = {r.employee.DEPARTMENT_ID for r in rows if r.employee and r.employee.DEPARTMENT_ID}
    role_ids = {r.employee.ROLE_ID for r in rows if r.employee and r.employee.ROLE_ID}
    cache = {}
    for d in db.query(Department).filter(Department.ID.in_(dept_ids)).all():
        cache[("dept", d.ID)] = d.NAME
    for rl in db.query(Role).filter(Role.ID.in_(role_ids)).all():
        cache[("role", rl.ID)] = rl.NAME

    return [_serialize_task(db, r, cache) for r in rows]
