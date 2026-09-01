"""Notification emails + in-app alerts for the automatic production
scheduling feature — structured identically to po_notification_service.py:
same recipient-resolution (email_send_rule_service.resolve_recipients),
same EmailTemplate/TEMPLATE_CATALOG content system, same Email Config
transport (send_via_vendor_smtp, falling back to send_via_resend).

Three independent notification paths:
  - send_production_schedule_approval_notification() — staff-facing,
    resolved via the PRODUCTION_SCHEDULE_APPROVAL_NEEDED Email Send Rule
    event (same dedup / Lead-Owner resolution as every other rule event),
    plus one in-app Notification row per resolved recipient.
  - send_employee_task_assignment_emails() — employee-facing, sent
    directly to each assigned employee's own Employee.EMAIL (not an
    Email Send Rule event — there is no "recipient list" to resolve, the
    recipient IS the employee whose task this is). One consolidated
    email per employee covering every task assigned to them in this
    batch, per the "do not spam one email per task" requirement.
  - send_task_reminder_email() — employee-facing, one task at a time;
    used by production_reminder_scheduler.py for the day-before /
    start-date reminders.

REF_ID on Notification is an Integer column and CustomerProjectTask/
ProductionSchedule IDs are UUID strings, so these notifications carry
REF_TYPE only (no REF_ID) — the existing frontend notification-click
handler only special-cases REF_TYPE="MEMO" and treats any other type as a
plain (safe, no-op) mark-as-read, so this is a compatible, non-breaking
simplification rather than a half-built deep link.
"""

import logging
import os
from collections import defaultdict
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import Employee, Notification, VendorEmailConfig
from app.services.email_send_rule_service import resolve_recipients
from app.services.email_template_service import get_template_for_send, render_template
from app.services.email_service import send_via_vendor_smtp, send_via_resend
from app.services.email_logo_service import build_email_logo, apply_cid_logo, extract_cid_logo
from app.services.company_settings_service import get_company_settings
from app.services.lead_quotation_service import company_branding_variables

log = logging.getLogger(__name__)


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _send_recipient_via_email_config(
    db: Session, vendor_id: int, recipient_email: str, subject: str, html: str,
    logo_bytes: bytes = None, logo_content_type: str = "image/png",
) -> tuple:
    """One recipient, via the Email Config pipeline — identical pattern to
    po_notification_service.py's own copy (each notification file owns
    its copy rather than sharing one, matching this codebase's existing
    convention of duplicating this block at every call site)."""
    active_cfgs = db.query(VendorEmailConfig).filter(
        VendorEmailConfig.VENDOR_ID == vendor_id, VendorEmailConfig.IS_ACTIVE == True,  # noqa: E712
    ).all()
    for cfg in active_cfgs:
        ok, err, _detail = send_via_vendor_smtp(
            cfg, recipient_email, subject, html,
            logo_bytes=logo_bytes, logo_content_type=logo_content_type,
        )
        if ok:
            return True, "Sent"
        log.warning("_send_recipient_via_email_config: vendor SMTP config %s failed: %s", cfg.ID, err)

    ok, err = send_via_resend(subject=subject, body_html=html, recipient=recipient_email)
    if ok:
        return True, "Sent via Resend fallback"
    return False, err or "Failed to send — no working email configuration."


def _render_and_send(db, vendor_id, company, logo_bytes, body_html, subject, recipient_email, variables) -> tuple:
    rendered_subject, rendered_html = render_template(body_html, subject, variables)
    rendered_html = apply_cid_logo(rendered_html, logo_bytes, company)
    recipient_logo_bytes = logo_bytes
    recipient_logo_content_type = "image/png"
    if not recipient_logo_bytes:
        rendered_html, recipient_logo_bytes, recipient_logo_content_type = extract_cid_logo(rendered_html)
    try:
        return _send_recipient_via_email_config(
            db, vendor_id, recipient_email, rendered_subject, rendered_html,
            logo_bytes=recipient_logo_bytes, logo_content_type=recipient_logo_content_type,
        )
    except Exception as e:
        log.exception("_render_and_send: failed sending to %s", recipient_email)
        return False, f"{type(e).__name__}: {e}"


def _build_unit_plan_table_html(unit_summaries: list) -> str:
    """`unit_summaries`: [{unit, start, end}, ...] — one row per project
    unit's own planned window, from task_generation_service.
    build_schedule_plan()'s plan["unit_summaries"]. Empty/absent for a
    project with no UNIT-scope tasks (a single project-wide run has no
    per-unit breakdown to show, not an error)."""
    if not unit_summaries:
        return "<p style='color:#94a3b8;'>No per-unit breakdown — this project has no unit-scoped tasks.</p>"
    rows_html = "".join(
        "<tr>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;'>Unit {u.get('unit')}</td>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;'>{u['start'].strftime('%d %b %Y') if u.get('start') else '—'}</td>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;'>{u['end'].strftime('%d %b %Y') if u.get('end') else '—'}</td>"
        "</tr>"
        for u in unit_summaries
    )
    return (
        "<table style='width:100%;border-collapse:collapse;margin-top:8px;'>"
        "<thead><tr>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Unit</th>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Start</th>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>End</th>"
        "</tr></thead><tbody>" + rows_html + "</tbody></table>"
    )


def _build_manpower_summary_table_html(manpower_summary: list) -> str:
    """`manpower_summary`: [{department, role, experience_level,
    required, matched, employees: [names]}, ...] — from
    task_generation_service.build_schedule_plan()'s plan[
    "manpower_summary"], already aggregated across every task/unit."""
    if not manpower_summary:
        return "<p style='color:#94a3b8;'>No manpower data available.</p>"
    rows_html = "".join(
        "<tr>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;'>{row.get('department') or '—'}</td>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;'>{row.get('role') or '—'}</td>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;'>{row.get('experience_level') or '—'}</td>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;text-align:center;'>{row.get('matched', 0)} / {row.get('required', 0)}</td>"
        f"<td style='padding:8px;border:1px solid #e5e7eb;'>{', '.join(row.get('employees') or []) or '—'}</td>"
        "</tr>"
        for row in manpower_summary
    )
    return (
        "<table style='width:100%;border-collapse:collapse;margin-top:8px;'>"
        "<thead><tr>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Department</th>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Role</th>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Level</th>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:center;'>Matched</th>"
        "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Employees</th>"
        "</tr></thead><tbody>" + rows_html + "</tbody></table>"
    )


def send_production_schedule_approval_notification(
    db: Session, *, vendor_id: int, schedule, assignment, customer, project, lead: Optional[object],
    plan: Optional[dict] = None,
) -> list:
    """Best-effort — resolves recipients via the
    PRODUCTION_SCHEDULE_APPROVAL_NEEDED Email Send Rule event, sends one
    independent email per recipient plus one in-app Notification row
    each. Returns [(recipient_email, sent, message), ...] for
    diagnostics. Silently returns [] if the rule has no recipients
    configured (a valid, expected state — mirrors every other event).

    `plan`: the full dict returned by task_generation_service.
    build_schedule_plan() for this proposal — carries Quantity/parallel-
    capacity/per-unit-plan/manpower-summary data the schedule row itself
    doesn't expose as columns (it only rides inside PLAN_SNAPSHOT_JSON).
    Passed in directly from the SAME pass that produced the schedule
    rather than re-parsed from the DB, so it's never stale."""
    recipients = resolve_recipients(db, vendor_id, "PRODUCTION_SCHEDULE_APPROVAL_NEEDED", lead=lead)
    if not recipients:
        return []

    body_html, subject = get_template_for_send(db, vendor_id, "PRODUCTION_SCHEDULE_APPROVAL")
    if not body_html:
        log.warning("send_production_schedule_approval_notification: no PRODUCTION_SCHEDULE_APPROVAL template configured")
        return [(e.EMAIL, False, "No email template configured") for e in recipients]

    lead_owner_name = ""
    if lead is not None and lead.ASSIGNED_TO_ID:
        owner = db.query(Employee).filter(Employee.ID == lead.ASSIGNED_TO_ID).first()
        lead_owner_name = owner.NAME if owner else ""

    review_url = f"{_frontend_url()}/production-schedule/{schedule.ID}"

    plan = plan or {}
    branding = company_branding_variables(db, vendor_id)
    shared_variables = {
        **branding,
        "our_company_name": branding["company_name"],
        "customer_name": customer.NAME or "",
        "company_name": customer.COMPANY_NAME or "",
        "lead_owner_name": lead_owner_name,
        "project_name": project.NAME or "",
        "suggested_start_date": schedule.SUGGESTED_START_DATE.strftime("%d %b %Y") if schedule.SUGGESTED_START_DATE else "",
        "estimated_completion_date": schedule.ESTIMATED_COMPLETION_DATE.strftime("%d %b %Y") if schedule.ESTIMATED_COMPLETION_DATE else "",
        "estimated_duration_days": f"{float(schedule.ESTIMATED_DURATION_DAYS):.1f}" if schedule.ESTIMATED_DURATION_DAYS is not None else "",
        "suggested_reason": schedule.SUGGESTED_REASON or "",
        "review_url": review_url,
        "quantity": str(assignment.QUANTITY or 1),
        "available_production_capacity": str(plan.get("parallel_capacity") or 1),
        "unit_plan_table_html": _build_unit_plan_table_html(plan.get("unit_summaries") or []),
        "manpower_summary_table_html": _build_manpower_summary_table_html(plan.get("manpower_summary") or []),
    }

    company = get_company_settings(db, vendor_id)
    logo_bytes, _logo_content_type, _logo_html = build_email_logo(company)

    results = []
    for emp in recipients:
        if not emp.EMAIL:
            continue
        variables = {**shared_variables, "recipient_name": emp.NAME or ""}
        ok, message = _render_and_send(db, vendor_id, company, logo_bytes, body_html, subject, emp.EMAIL, variables)
        if not ok:
            log.warning("send_production_schedule_approval_notification: failed sending to %s: %s", emp.EMAIL, message)
        results.append((emp.EMAIL, ok, message))

        db.add(Notification(
            VENDOR_ID=vendor_id,
            EMPLOYEE_ID=emp.ID,
            TYPE="WARNING",
            TITLE="Production Schedule Awaiting Approval",
            MESSAGE=f"A production schedule for {customer.NAME or 'a customer'} — {project.NAME or 'a project'} is awaiting your approval.",
            REF_TYPE="PRODUCTION_SCHEDULE",
        ))
    db.flush()
    return results


def send_employee_task_assignment_emails(db: Session, *, vendor_id: int, project, customer, tasks: list) -> list:
    """`tasks`: CustomerProjectTask rows just created/assigned in this
    generation batch (EMPLOYEE_ID/TASK_TEMPLATE_ID/PLANNED_START_DATE/
    DUE_DATE already populated). Groups by EMPLOYEE_ID and sends ONE
    consolidated email per employee even when they received multiple
    tasks in this batch — per the "do not spam one email per task"
    requirement."""
    by_employee = defaultdict(list)
    for t in tasks:
        if t.EMPLOYEE_ID:
            by_employee[t.EMPLOYEE_ID].append(t)
    if not by_employee:
        return []

    body_html, subject_tpl = get_template_for_send(db, vendor_id, "EMPLOYEE_TASK_ASSIGNMENT")
    if not body_html:
        log.warning("send_employee_task_assignment_emails: no EMPLOYEE_TASK_ASSIGNMENT template configured")
        return []

    company = get_company_settings(db, vendor_id)
    logo_bytes, _logo_content_type, _logo_html = build_email_logo(company)
    branding = company_branding_variables(db, vendor_id)

    results = []
    for employee_id, emp_tasks in by_employee.items():
        emp = db.query(Employee).filter(Employee.ID == employee_id).first()
        if not emp or not emp.EMAIL:
            continue

        rows_html = ""
        for t in emp_tasks:
            name = t.task_template.NAME if t.task_template else "Task"
            unit_label = f" (Unit {t.PROJECT_UNIT_NUMBER})" if t.PROJECT_UNIT_NUMBER else ""
            start_s = t.PLANNED_START_DATE.strftime("%d %b %Y %I:%M %p") if t.PLANNED_START_DATE else "—"
            due_s = t.DUE_DATE.strftime("%d %b %Y %I:%M %p") if t.DUE_DATE else "—"
            rows_html += (
                "<tr>"
                f"<td style='padding:8px;border:1px solid #e5e7eb;'>{name}{unit_label}</td>"
                f"<td style='padding:8px;border:1px solid #e5e7eb;'>{start_s}</td>"
                f"<td style='padding:8px;border:1px solid #e5e7eb;'>{due_s}</td>"
                "</tr>"
            )
        tasks_table_html = (
            "<table style='width:100%;border-collapse:collapse;margin-top:12px;'>"
            "<thead><tr>"
            "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Task</th>"
            "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Planned Start</th>"
            "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Due</th>"
            "</tr></thead><tbody>" + rows_html + "</tbody></table>"
        )

        task_count = len(emp_tasks)
        subject = subject_tpl.replace("{{task_count_suffix}}", f" ({task_count} Tasks)" if task_count > 1 else "")

        variables = {
            **branding,
            "recipient_name": emp.NAME or "",
            "project_name": project.NAME or "",
            "customer_name": customer.NAME or "",
            "task_count": str(task_count),
            "tasks_table_html": tasks_table_html,
        }
        ok, message = _render_and_send(db, vendor_id, company, logo_bytes, body_html, subject, emp.EMAIL, variables)
        if not ok:
            log.warning("send_employee_task_assignment_emails: failed sending to %s: %s", emp.EMAIL, message)
        results.append((emp.EMAIL, ok, message))

        db.add(Notification(
            VENDOR_ID=vendor_id,
            EMPLOYEE_ID=emp.ID,
            TYPE="INFO",
            TITLE="New Task Assignment" + (f" ({task_count} Tasks)" if task_count > 1 else ""),
            MESSAGE=f"You have been assigned {task_count} task(s) on {project.NAME or 'a project'} for {customer.NAME or 'a customer'}.",
            REF_TYPE="CUSTOMER_PROJECT_TASK",
        ))
    db.flush()
    return results


def send_production_scheduled_customer_notification(db: Session, *, vendor_id: int, customer, project, schedule) -> bool:
    """Customer-facing (not an Email Send Rule event — there is no
    internal recipient list to resolve here, the recipient IS the
    customer, same pattern as the existing PO-request customer email).
    Fired once, when a ProductionSchedule is locked in (APPROVED) — see
    production_scheduling_service._advance_lead_to_production_scheduled().
    Best-effort — never raises, returns False on any failure so the
    caller can log it without letting it block the approval itself."""
    if not customer or not customer.EMAIL:
        return False

    body_html, subject = get_template_for_send(db, vendor_id, "PRODUCTION_SCHEDULED_NOTIFICATION")
    if not body_html:
        log.warning("send_production_scheduled_customer_notification: no PRODUCTION_SCHEDULED_NOTIFICATION template configured")
        return False

    company = get_company_settings(db, vendor_id)
    logo_bytes, _logo_content_type, _logo_html = build_email_logo(company)
    branding = company_branding_variables(db, vendor_id)

    start_date = schedule.CHOSEN_START_DATE or schedule.SUGGESTED_START_DATE
    variables = {
        **branding,
        "recipient_name": customer.NAME or "",
        "company_name": customer.COMPANY_NAME or "",
        "project_name": project.NAME or "",
        "production_start_date": start_date.strftime("%d %b %Y") if start_date else "",
        "estimated_completion_date": schedule.ESTIMATED_COMPLETION_DATE.strftime("%d %b %Y") if schedule.ESTIMATED_COMPLETION_DATE else "",
    }
    ok, message = _render_and_send(db, vendor_id, company, logo_bytes, body_html, subject, customer.EMAIL, variables)
    if not ok:
        log.warning("send_production_scheduled_customer_notification: failed sending to %s: %s", customer.EMAIL, message)
    return ok


def send_task_reminder_email(db: Session, *, vendor_id: int, task, template_type: str) -> bool:
    """`template_type`: "TASK_REMINDER_DAY_BEFORE" or
    "TASK_REMINDER_START_DATE". One task at a time — the caller
    (production_reminder_scheduler.py) owns the idempotency guard columns
    and the daily batching. Returns True only on a confirmed send (the
    caller only stamps the guard column when this returns True)."""
    if not task.EMPLOYEE_ID:
        return False
    emp = db.query(Employee).filter(Employee.ID == task.EMPLOYEE_ID).first()
    if not emp or not emp.EMAIL:
        return False

    body_html, subject = get_template_for_send(db, vendor_id, template_type)
    if not body_html:
        log.warning("send_task_reminder_email: no %s template configured", template_type)
        return False

    task_template = task.task_template
    project = task_template.project if task_template else None
    assignment = task.assignment
    customer = assignment.customer if assignment else None
    requirement = task_template.requirements[0] if task_template and task_template.requirements else None

    company = get_company_settings(db, vendor_id)
    logo_bytes, _logo_content_type, _logo_html = build_email_logo(company)
    branding = company_branding_variables(db, vendor_id)

    variables = {
        **branding,
        "recipient_name": emp.NAME or "",
        "task_name": task_template.NAME if task_template else "Task",
        "project_name": project.NAME if project else "",
        "customer_name": customer.NAME if customer else "",
        "planned_start_date": task.PLANNED_START_DATE.strftime("%d %b %Y %I:%M %p") if task.PLANNED_START_DATE else "",
        "due_date": task.DUE_DATE.strftime("%d %b %Y %I:%M %p") if task.DUE_DATE else "",
        "department": requirement.department.NAME if requirement and requirement.department else "",
        "role": requirement.role.NAME if requirement and requirement.role else "",
    }
    ok, message = _render_and_send(db, vendor_id, company, logo_bytes, body_html, subject, emp.EMAIL, variables)
    if not ok:
        log.warning("send_task_reminder_email: failed sending to %s: %s", emp.EMAIL, message)
        return False

    db.add(Notification(
        VENDOR_ID=vendor_id,
        EMPLOYEE_ID=emp.ID,
        TYPE="INFO",
        TITLE="Task starts tomorrow" if template_type == "TASK_REMINDER_DAY_BEFORE" else "Task starts today",
        MESSAGE=f"Your task '{task_template.NAME if task_template else 'Task'}' starts "
                f"{'tomorrow' if template_type == 'TASK_REMINDER_DAY_BEFORE' else 'today'}.",
        REF_TYPE="CUSTOMER_PROJECT_TASK",
    ))
    db.flush()
    return True
