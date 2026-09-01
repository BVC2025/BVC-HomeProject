"""Orchestrator for the automatic production scheduling workflow —
Payment Milestone Reached -> Propose Schedule -> Approve/Reject ->
Generate & Assign Tasks. Three entry points, each transaction-safe
(flushes only; the caller commits, matching this codebase's existing
convention — see payment_milestone_service.evaluate_milestones_for_
assignment(), which also only flushes):

  - evaluate_and_propose_schedule(db, assignment) — called from
    payment_milestone_service once the FIRST configured Payment
    Milestone is reached. Idempotent: a ProductionSchedule already
    existing for this assignment (checked both in-process and, for a
    genuine concurrent race, via a SAVEPOINT around the insert backed by
    ProductionSchedule.ASSIGNMENT_ID's DB-level UNIQUE constraint) is
    returned as-is rather than proposing a second time.
  - approve_schedule(db, schedule_id, approved_by_employee_id) — locks
    the schedule row, generates real CustomerProjectTask rows + sends
    consolidated per-employee assignment emails. Idempotent via
    TASKS_GENERATED_AT.
  - reject_and_reschedule(db, schedule_id, new_start_date, ...) — per
    the specified workflow, rejecting IS itself the confirmation of a
    new date (no second approval round-trip): validates the new date is
    not earlier than the original SUGGESTED_START_DATE, re-validates
    availability/manpower against it, then proceeds directly into the
    same generate + assign path as approve.
"""

import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import ProductionSchedule, CustomerProjectAssignment, Project, Lead, Notification
from app.utils.datetime_utils import now_ist
from app.services import company_schedule_service
from app.services.task_generation_service import build_schedule_plan, generate_tasks_for_schedule
from app.services import production_notification_service
from app.services.inventory_consumption_service import consume_stock_for_assignment

log = logging.getLogger(__name__)


def _notify_scheduling_setup_failure(db: Session, assignment: CustomerProjectAssignment, project: Project, error_detail: str) -> None:
    """A ScheduleValidationError/ValueError here almost always means a
    one-time setup gap (company working hours not configured yet, or the
    project has no tasks) rather than a per-customer problem — but
    without this, the ONLY trace of the failure is a server log line no
    one in the business ever sees, so a payment can silently cross its
    milestone with nothing visibly happening. Best-effort broadcast
    in-app alert (EMPLOYEE_ID=None — every existing broadcast
    Notification in this codebase uses this same "NULL = everyone"
    convention), never raises."""
    try:
        db.add(Notification(
            VENDOR_ID=assignment.VENDOR_ID,
            TYPE="WARNING",
            TITLE="Production scheduling could not be proposed",
            MESSAGE=(
                f"A payment milestone was reached for project '{project.NAME}', but an automatic "
                f"production schedule could not be generated: {error_detail} "
                "Check the Company Profile page's Working Hours configuration and the project's task setup."
            ),
        ))
        db.flush()
    except Exception:
        log.exception("_notify_scheduling_setup_failure: failed to record notification for assignment %s", assignment.ID)


def _serialize_plan(plan: dict) -> str:
    def ser(v):
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, dict):
            return {k: ser(x) for k, x in v.items()}
        if isinstance(v, list):
            return [ser(x) for x in v]
        return v
    return json.dumps(ser({
        "items": plan["items"],
        "overall_start": plan["overall_start"],
        "overall_end": plan["overall_end"],
        "estimated_duration_days": plan["estimated_duration_days"],
        "shortages": plan["shortages"],
        "parallel_capacity": plan.get("parallel_capacity"),
        "unit_summaries": plan.get("unit_summaries"),
        "manpower_summary": plan.get("manpower_summary"),
    }))


def _derive_suggested_start(plan: dict, start_instant: datetime) -> tuple:
    """SUGGESTED_START_DATE is `plan['overall_start']` — computed once,
    consistently, inside `build_schedule_plan()` itself (the same anchor
    `estimated_duration_days`/`ESTIMATED_COMPLETION_DATE` are derived
    from, so the three numbers always agree). This function only builds
    the human-readable `reason` string: whether that start is "right
    away," constrained by a specific busy employee, or blocked by a
    genuine manpower shortage — scanning first-wave items (those whose
    own item['start'] == the raw start_instant this schedule was
    proposed against, i.e. not waiting on an earlier SEQUENTIAL item)."""
    suggested_start = plan["overall_start"]
    first_wave = [item for item in plan["items"] if item["start"] == start_instant]
    member_starts = [mp["start"] for item in first_wave for mp in item["members"]]
    if not member_starts:
        return suggested_start, "No manpower requirements are configured for this project's tasks — production can begin immediately."

    waiting_bits = set()
    for item in first_wave:
        for mp in item["members"]:
            for req in mp["requirements"]:
                for m in req["matches"]:
                    if m["start"] > start_instant:
                        waiting_bits.add(
                            f"{req.get('role') or 'Employee'} in {req.get('department') or 'department'} "
                            f"(free from {m['start'].strftime('%d %b %Y')})"
                        )

    if plan["shortages"]:
        # A UNIT-scope task's shortage is reported once per unit (each
        # unit independently needs its own matching employee) — consolidate
        # identical (role, department, experience_level) entries into one
        # summed line rather than repeating the same shortage per unit.
        consolidated: dict = {}
        for s in plan["shortages"]:
            key = (s.get("role"), s.get("department"), s.get("experience_level"))
            consolidated[key] = consolidated.get(key, 0) + s["missing_count"]
        shortage_bits = [
            f"{count} more {role or 'employee(s)'} in {dept or 'department'} ({exp})"
            for (role, dept, exp), count in consolidated.items()
        ]
        reason = (
            "Manpower shortage detected — missing: " + "; ".join(shortage_bits) + ". "
            "The schedule below reflects only the currently eligible employees; resolve the "
            "shortage (hire/reassign/reduce scope) before approving, or approve as-is to "
            "proceed with a partial assignment."
        )
    elif waiting_bits:
        reason = "Earliest possible start based on employee availability — waiting on: " + "; ".join(sorted(waiting_bits)) + "."
    else:
        reason = "All required employees are available immediately — production can begin right away."

    return suggested_start, reason


def evaluate_and_propose_schedule(db: Session, assignment: CustomerProjectAssignment) -> Optional[ProductionSchedule]:
    """Best-effort, never raises — a scheduling failure must not block
    the payment/milestone update that triggered it (same philosophy as
    payment_milestone_service's own milestone-request email). Returns
    the (possibly pre-existing) ProductionSchedule, or None if a
    schedule genuinely could not be proposed (no project, no tasks
    configured, or company working hours not yet configured — all
    one-time setup problems logged at ERROR for visibility, not
    per-customer failures)."""
    existing = db.query(ProductionSchedule).filter(ProductionSchedule.ASSIGNMENT_ID == assignment.ID).first()
    if existing:
        return existing

    project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first()
    if not project:
        log.error("evaluate_and_propose_schedule: assignment %s has no linked project — cannot schedule", assignment.ID)
        return None

    start_instant = now_ist()
    try:
        plan = build_schedule_plan(db, assignment, project, start_instant, dry_run=True)
    except (company_schedule_service.ScheduleValidationError, ValueError) as e:
        log.error("evaluate_and_propose_schedule: cannot propose schedule for assignment %s: %s", assignment.ID, e)
        _notify_scheduling_setup_failure(db, assignment, project, str(e))
        return None

    suggested_start, reason = _derive_suggested_start(plan, start_instant)

    schedule = ProductionSchedule(
        ASSIGNMENT_ID=assignment.ID,
        SUGGESTED_START_DATE=suggested_start,
        SUGGESTED_REASON=reason,
        ESTIMATED_DURATION_DAYS=plan["estimated_duration_days"],
        ESTIMATED_COMPLETION_DATE=plan["overall_end"],
        STATUS="PROPOSED",
        PLAN_SNAPSHOT_JSON=_serialize_plan(plan),
    )
    db.add(schedule)
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        # A concurrent payment-triggered evaluation beat us to it — the
        # ASSIGNMENT_ID unique constraint caught it. Roll back only this
        # attempt (the SAVEPOINT), keep the caller's outer transaction
        # (e.g. the milestone-status flip) intact, and use their row.
        log.info("evaluate_and_propose_schedule: concurrent propose detected for assignment %s", assignment.ID)
        return db.query(ProductionSchedule).filter(ProductionSchedule.ASSIGNMENT_ID == assignment.ID).first()

    lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first() if assignment.LEAD_ID else None
    customer = assignment.customer
    try:
        production_notification_service.send_production_schedule_approval_notification(
            db, vendor_id=assignment.VENDOR_ID, schedule=schedule, assignment=assignment,
            customer=customer, project=project, lead=lead, plan=plan,
        )
    except Exception:
        log.exception("evaluate_and_propose_schedule: notification failed for schedule %s", schedule.ID)
    db.flush()
    return schedule


def _advance_lead_to_production_scheduled(db: Session, schedule: ProductionSchedule, assignment: CustomerProjectAssignment, project: Project) -> None:
    """Side effect of a schedule being locked in (APPROVED) — flips the
    originating Lead's LEAD_STATUS to PRODUCTION_SCHEDULED (a system-only
    status, see lead_management.py's _SYSTEM_ONLY_LEAD_STATUSES) and
    emails the customer. Best-effort: a lead lookup/email failure must
    never block the schedule approval that triggered it. No-op if this
    assignment has no linked Lead (e.g. a legacy/manually-created
    assignment) or the lead has already moved past this point."""
    if not assignment.LEAD_ID:
        return
    try:
        lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first()
        if not lead or lead.LEAD_STATUS in ("PRODUCTION_SCHEDULED", "PRODUCTION_STARTED"):
            return
        lead.LEAD_STATUS = "PRODUCTION_SCHEDULED"
        db.flush()
        production_notification_service.send_production_scheduled_customer_notification(
            db, vendor_id=assignment.VENDOR_ID, customer=assignment.customer, project=project, schedule=schedule,
        )
    except Exception:
        log.exception("_advance_lead_to_production_scheduled: failed for assignment %s", assignment.ID)


def approve_schedule(db: Session, schedule_id: str, approved_by_employee_id: str) -> ProductionSchedule:
    schedule = (
        db.query(ProductionSchedule)
          .filter(ProductionSchedule.ID == schedule_id)
          .with_for_update()
          .first()
    )
    if not schedule:
        raise ValueError("Production schedule not found.")
    if schedule.STATUS == "APPROVED":
        return schedule  # idempotent — already approved (e.g. a duplicate approve click)
    if schedule.STATUS != "PROPOSED":
        raise ValueError(f"This schedule is already {schedule.STATUS} and cannot be approved.")

    assignment = db.query(CustomerProjectAssignment).filter(CustomerProjectAssignment.ID == schedule.ASSIGNMENT_ID).first()
    project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first()

    plan = generate_tasks_for_schedule(db, schedule, assignment, project)
    created_rows = plan["created_rows"]

    schedule.STATUS = "APPROVED"
    schedule.APPROVED_BY_ID = approved_by_employee_id
    schedule.APPROVED_AT = now_ist()
    schedule.TASKS_GENERATED_AT = now_ist()
    # Refresh the schedule's date/duration/plan fields from the REAL
    # generation pass (employee availability may have shifted since the
    # original proposal) — mirrors reject_and_reschedule()'s own existing
    # recompute-after-generation behavior, closing the gap where approve
    # previously left these frozen at propose-time.
    schedule.ESTIMATED_COMPLETION_DATE = plan["overall_end"]
    schedule.ESTIMATED_DURATION_DAYS = plan["estimated_duration_days"]
    schedule.PLAN_SNAPSHOT_JSON = _serialize_plan(plan)
    db.flush()

    try:
        production_notification_service.send_employee_task_assignment_emails(
            db, vendor_id=assignment.VENDOR_ID, project=project, customer=assignment.customer, tasks=created_rows,
        )
    except Exception:
        log.exception("approve_schedule: assignment-email failed for schedule %s", schedule.ID)
    try:
        consume_stock_for_assignment(db, assignment, project, performed_by_employee_id=approved_by_employee_id)
    except Exception:
        log.exception("approve_schedule: inventory consumption failed for schedule %s", schedule.ID)
    _advance_lead_to_production_scheduled(db, schedule, assignment, project)
    db.flush()
    return schedule


def reject_and_reschedule(
    db: Session, schedule_id: str, new_start_date: datetime, rejected_by_employee_id: str,
    reason: Optional[str] = None,
) -> ProductionSchedule:
    schedule = (
        db.query(ProductionSchedule)
          .filter(ProductionSchedule.ID == schedule_id)
          .with_for_update()
          .first()
    )
    if not schedule:
        raise ValueError("Production schedule not found.")
    if schedule.STATUS == "REJECTED":
        return schedule  # idempotent — already rejected (e.g. a duplicate submit click)
    if schedule.STATUS != "PROPOSED":
        raise ValueError(f"This schedule is already {schedule.STATUS} and cannot be rejected.")
    if new_start_date < schedule.SUGGESTED_START_DATE:
        raise ValueError(
            "The chosen date must be on or after the suggested earliest date "
            f"({schedule.SUGGESTED_START_DATE.strftime('%d %b %Y')}) — required employees are not available before then."
        )

    assignment = db.query(CustomerProjectAssignment).filter(CustomerProjectAssignment.ID == schedule.ASSIGNMENT_ID).first()
    project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first()

    # Revalidate — availability/manpower may have shifted since the
    # original proposal, and the user picked a specific later date.
    plan = build_schedule_plan(db, assignment, project, new_start_date, dry_run=True)

    schedule.CHOSEN_START_DATE = new_start_date
    schedule.STATUS = "REJECTED"
    schedule.REJECTED_BY_ID = rejected_by_employee_id
    schedule.REJECTED_AT = now_ist()
    schedule.REJECT_REASON = reason
    schedule.ESTIMATED_COMPLETION_DATE = plan["overall_end"]
    schedule.ESTIMATED_DURATION_DAYS = plan["estimated_duration_days"]
    schedule.PLAN_SNAPSHOT_JSON = _serialize_plan(plan)
    db.flush()

    generated_plan = generate_tasks_for_schedule(db, schedule, assignment, project)
    created_rows = generated_plan["created_rows"]
    schedule.TASKS_GENERATED_AT = now_ist()
    db.flush()

    try:
        production_notification_service.send_employee_task_assignment_emails(
            db, vendor_id=assignment.VENDOR_ID, project=project, customer=assignment.customer, tasks=created_rows,
        )
    except Exception:
        log.exception("reject_and_reschedule: assignment-email failed for schedule %s", schedule.ID)
    try:
        consume_stock_for_assignment(db, assignment, project, performed_by_employee_id=rejected_by_employee_id)
    except Exception:
        log.exception("reject_and_reschedule: inventory consumption failed for schedule %s", schedule.ID)
    _advance_lead_to_production_scheduled(db, schedule, assignment, project)
    db.flush()
    return schedule
