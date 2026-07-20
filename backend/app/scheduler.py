"""
Lead polling scheduler.

Job 1 — polling tick: every minute, check every active LeadPollingConfig and
sync the ones whose POLL_INTERVAL_MINUTES has elapsed since LAST_SYNCED_AT.
Single global tick (not one APScheduler job per config) avoids dynamically
adding/removing jobs whenever a config's interval or active flag changes via
the CRUD API — changes are simply picked up on the next tick.

Job 2 — polling-log cleanup: at 12:00 AM and 12:00 PM IST, truncate the
entire lead_polling_log table (not vendor-wise — a full truncate, per
requirement). Safe: no other table has an FK pointing INTO lead_polling_log.

Note: this assumes a single worker process (matching the rest of this app,
which runs as a single Uvicorn process). Running multiple worker processes
would each start their own scheduler and poll/truncate independently.
"""

import logging
import os
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from app.database.database import SessionLocal
from app.models.lead_models import LeadPollingConfig
from app.services.lead_polling_service import sync_config
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

_scheduler = None


def _tick():
    db = SessionLocal()
    try:
        configs = db.query(LeadPollingConfig).filter(LeadPollingConfig.IS_ACTIVE == True).all()  # noqa: E712
        now = now_ist()
        for cfg in configs:
            try:
                interval = cfg.POLL_INTERVAL_MINUTES or 5
                due = cfg.LAST_SYNCED_AT is None or (now - cfg.LAST_SYNCED_AT) >= timedelta(minutes=interval)
                if due:
                    sync_config(db, cfg)
            except Exception:
                log.exception("Lead polling tick failed for config %s", cfg.ID)
    except Exception:
        log.exception("Lead polling tick failed")
    finally:
        db.close()


def _truncate_polling_log():
    db = SessionLocal()
    try:
        db.execute(text("TRUNCATE TABLE lead_polling_log"))
        db.commit()
        log.info("lead_polling_log truncated (scheduled cleanup)")
    except Exception:
        db.rollback()
        log.exception("lead_polling_log truncate failed")
    finally:
        db.close()


def start_scheduler():
    """Idempotent. Respects the LEAD_POLLING_ENABLED kill-switch (default on)."""
    global _scheduler
    if _scheduler is not None:
        return

    if (os.getenv("LEAD_POLLING_ENABLED", "1") or "1").strip().lower() in ("0", "false", "no"):
        log.info("Lead polling scheduler disabled via LEAD_POLLING_ENABLED")
        return

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        _tick,
        "interval",
        minutes=1,
        id="lead_polling_tick",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        _truncate_polling_log,
        CronTrigger(hour="0,12", minute=0, timezone="Asia/Kolkata"),
        id="lead_polling_log_cleanup",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("Lead polling scheduler started (tick every 1 minute, log cleanup at 00:00 & 12:00 IST)")
