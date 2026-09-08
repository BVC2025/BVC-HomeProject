"""Background scheduler for calendar reminders.

Independent of the lead-polling scheduler in scheduler.py so the two
have unrelated kill-switches. Runs every 2 minutes, scans every vendor's
SCHEDULED events, and creates one Notification per event that has
crossed its reminder window.

Env kill-switch: CALENDAR_REMINDERS_ENABLED=0 disables it.
"""

from __future__ import annotations

import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler

from app.database.database import SessionLocal
from app.routes.calendar import _scan_reminders_impl


log = logging.getLogger("uvicorn.error")
_scheduler: BackgroundScheduler | None = None


def _tick() -> None:
    """One reminder-scan tick across ALL vendors."""
    db = SessionLocal()
    try:
        res = _scan_reminders_impl(db, vendor_id=None)
        if res.get("fired"):
            log.info(
                "[calendar-reminders] fired=%s at=%s",
                res["fired"], res["checked_at"],
            )
    except Exception as e:
        log.warning(
            "[calendar-reminders] tick failed: %s: %s",
            type(e).__name__, e,
        )
    finally:
        db.close()


def start_calendar_scheduler() -> None:
    """Idempotent. Called once on FastAPI startup."""
    global _scheduler
    if _scheduler is not None:
        return

    disabled = (os.getenv("CALENDAR_REMINDERS_ENABLED", "1") or "1").strip().lower()
    if disabled in ("0", "false", "no"):
        log.info("Calendar reminders disabled via CALENDAR_REMINDERS_ENABLED")
        return

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        _tick,
        "interval",
        minutes=2,
        id="calendar_reminder_tick",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("Calendar reminder scheduler started (tick every 2 minutes)")


def stop_calendar_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
