"""Task start-date reminder scheduler for the automatic production
scheduling feature.

A SEPARATE BackgroundScheduler instance from app/scheduler.py (lead
polling) and app/whatsapp_scheduler.py (WhatsApp) — mirrors their exact
shape (max_instances=1, coalesce=True, CronTrigger in Asia/Kolkata) so a
bug in one can never stop another. Reminders are sent via a reliable
BACKEND daily job rather than a frontend timer, per the explicit
requirement that production notifications must not depend on a browser
being open.

Job 1 — day-before tick (08:00 IST): every CustomerProjectTask whose
PLANNED_START_DATE falls tomorrow and hasn't had its day-before reminder
sent yet.
Job 2 — start-date tick (07:00 IST): every CustomerProjectTask whose
PLANNED_START_DATE falls today and hasn't had its start-date reminder
sent yet.

Both guard columns (DAY_BEFORE_REMINDER_SENT_AT / START_DATE_REMINDER_
SENT_AT) are stamped immediately after a confirmed send, one row/commit
at a time, so a mid-batch crash re-sends at most the one in-flight
reminder on the next tick rather than the whole day's batch.
"""

import logging
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import func

from app.database.database import SessionLocal
from app.models.models import CustomerProjectTask
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

_scheduler = None

_ACTIVE_STATUSES = ("PENDING", "IN_PROGRESS", "EXTENDED")


def _send_batch(target_date, guard_column, template_type: str, label: str):
    from app.services.production_notification_service import send_task_reminder_email

    db = SessionLocal()
    sent = 0
    try:
        rows = db.query(CustomerProjectTask).filter(
            func.date(CustomerProjectTask.PLANNED_START_DATE) == target_date,
            CustomerProjectTask.STATUS.in_(_ACTIVE_STATUSES),
            guard_column.is_(None),
            CustomerProjectTask.EMPLOYEE_ID.isnot(None),
        ).all()

        for task in rows:
            assignment = task.assignment
            if not assignment:
                continue
            try:
                ok = send_task_reminder_email(db, vendor_id=assignment.VENDOR_ID, task=task, template_type=template_type)
            except Exception:
                log.exception("%s: failed sending reminder for task %s", label, task.ID)
                db.rollback()
                continue
            if ok:
                if guard_column is CustomerProjectTask.DAY_BEFORE_REMINDER_SENT_AT:
                    task.DAY_BEFORE_REMINDER_SENT_AT = now_ist()
                else:
                    task.START_DATE_REMINDER_SENT_AT = now_ist()
                db.commit()
                sent += 1
            else:
                db.rollback()

        if rows:
            log.info("%s: %d/%d reminder(s) sent", label, sent, len(rows))
    except Exception:
        db.rollback()
        log.exception("%s: batch failed", label)
    finally:
        db.close()


def _day_before_tick():
    tomorrow = (now_ist() + timedelta(days=1)).date()
    _send_batch(tomorrow, CustomerProjectTask.DAY_BEFORE_REMINDER_SENT_AT, "TASK_REMINDER_DAY_BEFORE", "production_reminder_scheduler.day_before")


def _start_date_tick():
    today = now_ist().date()
    _send_batch(today, CustomerProjectTask.START_DATE_REMINDER_SENT_AT, "TASK_REMINDER_START_DATE", "production_reminder_scheduler.start_date")


def _advance_leads_to_production_started():
    """The "Product date at the first day -> automatically change status"
    rule: once any assignment's tasks actually start today, flip its
    originating Lead from PRODUCTION_SCHEDULED to PRODUCTION_STARTED.
    Only advances leads currently sitting at PRODUCTION_SCHEDULED — a
    lead that skipped straight past it (or was never scheduled through
    this engine) is left alone, and re-running this daily is a safe
    no-op for a lead already advanced on an earlier day."""
    from app.models.lead_models import Lead
    from app.models.customer_models import CustomerProjectAssignment

    db = SessionLocal()
    try:
        today = now_ist().date()
        assignment_ids = {
            row[0] for row in db.query(CustomerProjectTask.ASSIGNMENT_ID).filter(
                func.date(CustomerProjectTask.PLANNED_START_DATE) == today,
                CustomerProjectTask.STATUS.in_(_ACTIVE_STATUSES),
            ).distinct().all()
        }
        if not assignment_ids:
            return

        advanced = 0
        for assignment in db.query(CustomerProjectAssignment).filter(CustomerProjectAssignment.ID.in_(assignment_ids)).all():
            if not assignment.LEAD_ID:
                continue
            lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first()
            if not lead or lead.LEAD_STATUS != "PRODUCTION_SCHEDULED":
                continue
            lead.LEAD_STATUS = "PRODUCTION_STARTED"
            advanced += 1
        if advanced:
            db.commit()
            log.info("production_reminder_scheduler.advance_leads: advanced %d lead(s) to PRODUCTION_STARTED", advanced)
    except Exception:
        db.rollback()
        log.exception("production_reminder_scheduler.advance_leads: batch failed")
    finally:
        db.close()


def start_production_reminder_scheduler():
    """Idempotent — safe to call more than once (e.g. a hot reload)."""
    global _scheduler
    if _scheduler is not None:
        return

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        _day_before_tick, CronTrigger(hour=8, minute=0, timezone="Asia/Kolkata"),
        id="production_task_reminder_day_before", max_instances=1, coalesce=True,
    )
    _scheduler.add_job(
        _start_date_tick, CronTrigger(hour=7, minute=0, timezone="Asia/Kolkata"),
        id="production_task_reminder_start_date", max_instances=1, coalesce=True,
    )
    _scheduler.add_job(
        _advance_leads_to_production_started, CronTrigger(hour=6, minute=30, timezone="Asia/Kolkata"),
        id="production_advance_leads_to_started", max_instances=1, coalesce=True,
    )
    _scheduler.start()
    log.info("Production task reminder scheduler started (advance-leads tick 06:30 IST, start-date tick 07:00 IST, day-before tick 08:00 IST)")


def stop_production_reminder_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
