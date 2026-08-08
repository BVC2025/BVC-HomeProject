"""WhatsApp outbound/inbound drain scheduler.

A SEPARATE BackgroundScheduler instance from app/scheduler.py (IndiaMART
polling) — a bug in one can never stop the other. Mirrors scheduler.py's
own shape and single-worker-process assumption exactly (max_instances=1,
coalesce=True everywhere).

Job 1 — outbound tick: drains PENDING outbound WhatsAppMessage rows via
whatsapp_outbox_service.dispatch_outbound_once(), respecting per-vendor
throttles/daily caps/circuit breakers.

Job 2 — inbound tick: drains PENDING inbound WhatsAppMessage rows via
whatsapp_inbound_service.process_pending_inbound_once(), generating AI
replies.

Job 3 — reaper: resets rows stuck in SENDING/PROCESSING (a crash mid-send/
mid-processing) back to a retryable state, and clears any expired circuit
breaker (PAUSED_UNTIL).

Job 4 — webhook-event prune: deletes whatsapp_webhook_event rows older than
7 days (an append-only audit log with no FK pointing into it, same shape as
lead_polling_log's cleanup job).
"""
import logging
import os
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.database.database import SessionLocal
from app.models.whatsapp_models import VendorWhatsAppConfig, WhatsAppMessage, WhatsAppWebhookEvent
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

_scheduler = None
_STUCK_THRESHOLD = timedelta(minutes=5)
_WEBHOOK_EVENT_RETENTION_DAYS = int(os.getenv("WA_WEBHOOK_EVENT_RETENTION_DAYS", "7"))


def _outbound_tick():
    from app.services.whatsapp_outbox_service import dispatch_outbound_once
    try:
        dispatch_outbound_once()
    except Exception:
        log.exception("WhatsApp outbound tick failed")


def _inbound_tick():
    from app.services.whatsapp_inbound_service import process_pending_inbound_once
    try:
        process_pending_inbound_once()
    except Exception:
        log.exception("WhatsApp inbound tick failed")


def _reaper_tick():
    db = SessionLocal()
    try:
        cutoff = now_ist() - _STUCK_THRESHOLD

        stuck_out = db.query(WhatsAppMessage).filter(
            WhatsAppMessage.DIRECTION == "OUT",
            WhatsAppMessage.STATUS == "SENDING",
            WhatsAppMessage.QUEUED_AT < cutoff,
        ).all()
        for row in stuck_out:
            row.STATUS = "PENDING"

        stuck_in = db.query(WhatsAppMessage).filter(
            WhatsAppMessage.DIRECTION == "IN",
            WhatsAppMessage.PROCESSING_STATE == "PROCESSING",
            WhatsAppMessage.CREATED_AT < cutoff,
        ).all()
        for row in stuck_in:
            row.PROCESSING_STATE = "PENDING"
            row.NEXT_ATTEMPT_AT = now_ist()

        expired_pauses = db.query(VendorWhatsAppConfig).filter(
            VendorWhatsAppConfig.PAUSED_UNTIL.isnot(None),
            VendorWhatsAppConfig.PAUSED_UNTIL <= now_ist(),
        ).all()
        for cfg in expired_pauses:
            cfg.PAUSED_UNTIL = None

        if stuck_out or stuck_in or expired_pauses:
            db.commit()
            log.info(
                "WhatsApp reaper: reset %d stuck outbound, %d stuck inbound, cleared %d expired pauses",
                len(stuck_out), len(stuck_in), len(expired_pauses),
            )
    except Exception:
        db.rollback()
        log.exception("WhatsApp reaper tick failed")
    finally:
        db.close()


def _prune_webhook_events():
    db = SessionLocal()
    try:
        cutoff = now_ist() - timedelta(days=_WEBHOOK_EVENT_RETENTION_DAYS)
        deleted = db.query(WhatsAppWebhookEvent).filter(WhatsAppWebhookEvent.RECEIVED_AT < cutoff).delete()
        db.commit()
        if deleted:
            log.info("whatsapp_webhook_event pruned: %d row(s) older than %d days", deleted, _WEBHOOK_EVENT_RETENTION_DAYS)
    except Exception:
        db.rollback()
        log.exception("whatsapp_webhook_event prune failed")
    finally:
        db.close()


def start_whatsapp_scheduler():
    """Idempotent. Respects the WHATSAPP_AUTOMATION_ENABLED kill-switch
    (default on). When disabled, the webhook still accepts and stores
    messages — nothing is lost — but nothing is sent or auto-answered."""
    global _scheduler
    if _scheduler is not None:
        return

    if (os.getenv("WHATSAPP_AUTOMATION_ENABLED", "1") or "1").strip().lower() in ("0", "false", "no"):
        log.info("WhatsApp automation scheduler disabled via WHATSAPP_AUTOMATION_ENABLED")
        return

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(_outbound_tick, "interval", seconds=2, id="wa_outbound_tick", max_instances=1, coalesce=True)
    _scheduler.add_job(_inbound_tick, "interval", seconds=2, id="wa_inbound_tick", max_instances=1, coalesce=True)
    _scheduler.add_job(_reaper_tick, "interval", seconds=60, id="wa_reaper_tick", max_instances=1, coalesce=True)
    _scheduler.add_job(
        _prune_webhook_events,
        CronTrigger(hour=2, minute=30, timezone="Asia/Kolkata"),
        id="wa_webhook_event_prune",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("WhatsApp automation scheduler started (outbound/inbound every 2s, reaper every 60s, prune at 02:30 IST)")


def stop_whatsapp_scheduler():
    """Shut the scheduler down cleanly before the process's thread pools
    are torn down, so it stops submitting new ticks instead of spamming
    'cannot schedule new futures after shutdown' during interpreter exit."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
