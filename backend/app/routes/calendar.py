"""Calendar routes — schedule + list events, mark completion, and
scan-for-reminders (called by the background scheduler).

Endpoints:

  POST   /calendar/events               create
  GET    /calendar/events                list — filter by date, owner, lead, customer
  GET    /calendar/events/{id}           detail
  PATCH  /calendar/events/{id}           partial update
  POST   /calendar/events/{id}/complete  mark completed with optional outcome_notes
  DELETE /calendar/events/{id}           delete (soft-status CANCELLED instead)

  GET    /calendar/upcoming              upcoming events for one owner (dashboard widget)
  GET    /calendar/team                  team calendar (respects calendar.team_view)
  POST   /calendar/scan-reminders        scheduler-callable, generates notifications

RBAC:
  - view own → `calendar.view`
  - create/edit/complete → `calendar.manage`
  - see another owner's events → `calendar.team_view` (managers/admins)
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.auth.auth_bearer import (
    get_current_user,
    get_effective_vendor_id,
    require,
)
from app.database.database import get_db
from app.models.calendar_models import CalendarEvent
from app.models.lead_models import Lead
from app.models.models import Customer, Employee, Notification
from app.schemas.calendar_schema import (
    CalendarEventComplete,
    CalendarEventCreate,
    CalendarEventOut,
    CalendarEventUpdate,
)


router = APIRouter(prefix="/calendar", tags=["Calendar"])


# ---------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------

def _split_attendees(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [x.strip() for x in raw.split(",") if x.strip()]


def _join_attendees(ids: Optional[List[str]]) -> Optional[str]:
    if not ids:
        return None
    # de-dup + preserve order; comma-sep string in DB
    seen: List[str] = []
    for i in ids:
        s = str(i).strip()
        if s and s not in seen:
            seen.append(s)
    return ",".join(seen) or None


def _serialize(ev: CalendarEvent, db: Session) -> CalendarEventOut:
    owner_name = lead_name = customer_name = None

    if ev.OWNER_ID:
        emp = db.query(Employee).filter(Employee.ID == ev.OWNER_ID).first()
        if emp:
            owner_name = emp.NAME
    if ev.LEAD_ID:
        lead = db.query(Lead).filter(Lead.ID == ev.LEAD_ID).first()
        if lead:
            lead_name = lead.CONTACT_NAME or getattr(lead, "COMPANY_NAME", None) or ev.LEAD_ID
    if ev.CUSTOMER_ID:
        cust = db.query(Customer).filter(Customer.ID == ev.CUSTOMER_ID).first()
        if cust:
            customer_name = cust.CUSTOMER_NAME

    return CalendarEventOut(
        id               = ev.ID,
        vendor_id        = ev.VENDOR_ID,
        title            = ev.TITLE,
        description      = ev.DESCRIPTION,
        event_type       = ev.EVENT_TYPE,
        location         = ev.LOCATION,
        start_at         = ev.START_AT,
        end_at           = ev.END_AT,
        all_day          = bool(ev.ALL_DAY),
        status           = ev.STATUS,
        outcome_notes    = ev.OUTCOME_NOTES,
        owner_id         = ev.OWNER_ID,
        owner_name       = owner_name,
        created_by_id    = ev.CREATED_BY_ID,
        attendee_ids     = _split_attendees(ev.ATTENDEE_IDS),
        lead_id          = ev.LEAD_ID,
        lead_name        = lead_name,
        customer_id      = ev.CUSTOMER_ID,
        customer_name    = customer_name,
        reminder_minutes = ev.REMINDER_MINUTES,
        notify_emails    = ev.NOTIFY_EMAILS,
        reminder_sent    = bool(ev.REMINDER_SENT),
        created_at       = ev.CREATED_AT,
        updated_at       = ev.UPDATED_AT,
    )


# ---------------------------------------------------------------------
# Access-scoping helper
# ---------------------------------------------------------------------

def _can_see_other_owners(user: dict) -> bool:
    """Only admins / users with calendar.team_view see events owned by
    others. Everyone else is clamped to their own OWNER_ID + events
    where they're an attendee."""
    perms = set(user.get("permissions") or [])
    if user.get("principal_type") == "ROOT":
        return True
    if user.get("role") in ("ADMIN", "SUPER_ADMIN"):
        return True
    return "calendar.team_view" in perms


def _scope_query(q, user: dict):
    """Given a base CalendarEvent query, add the RBAC filter clause."""
    if _can_see_other_owners(user):
        return q
    emp_id = user.get("employee_id") or user.get("sub")
    if not emp_id:
        # Non-employee token (root logging in via IAM) with no team perm
        # → empty set is safest.
        return q.filter(CalendarEvent.ID == "__no_match__")
    return q.filter(
        or_(
            CalendarEvent.OWNER_ID == emp_id,
            CalendarEvent.CREATED_BY_ID == emp_id,
            CalendarEvent.ATTENDEE_IDS.like(f"%{emp_id}%"),
        )
    )


# ---------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------

@router.post(
    "/events",
    response_model=CalendarEventOut,
    dependencies=[Depends(require("calendar.manage"))],
)
def create_event(
    payload: CalendarEventCreate,
    db:      Session = Depends(get_db),
    user:    dict    = Depends(get_current_user),
    vid:     int     = Depends(get_effective_vendor_id),
) -> CalendarEventOut:

    creator_id = user.get("employee_id") or user.get("sub")
    owner_id   = payload.owner_id or creator_id

    # Only team-view users can put an event on someone else's calendar
    if owner_id and owner_id != creator_id and not _can_see_other_owners(user):
        raise HTTPException(
            403,
            "You can only create events on your own calendar.",
        )

    # Verify FK targets exist within this vendor (avoid dangling refs)
    if payload.lead_id:
        lead = db.query(Lead).filter(
            Lead.ID == payload.lead_id,
            Lead.VENDOR_ID == vid,
        ).first()
        if not lead:
            raise HTTPException(400, "lead_id not found in your account")

    if payload.customer_id:
        cust = db.query(Customer).filter(
            Customer.ID == payload.customer_id,
            Customer.VENDOR_ID == vid,
        ).first()
        if not cust:
            raise HTTPException(400, "customer_id not found in your account")

    ev = CalendarEvent(
        VENDOR_ID        = vid,
        TITLE            = payload.title.strip(),
        DESCRIPTION      = (payload.description or "").strip() or None,
        EVENT_TYPE       = payload.event_type,
        LOCATION         = (payload.location or "").strip() or None,
        START_AT         = payload.start_at,
        END_AT           = payload.end_at,
        ALL_DAY          = payload.all_day,
        OWNER_ID         = owner_id,
        CREATED_BY_ID    = creator_id,
        ATTENDEE_IDS     = _join_attendees(payload.attendee_ids),
        LEAD_ID          = payload.lead_id,
        CUSTOMER_ID      = payload.customer_id,
        REMINDER_MINUTES = payload.reminder_minutes,
        NOTIFY_EMAILS    = (payload.notify_emails or "").strip() or None,
        REMINDER_SENT    = False,
        STATUS           = "SCHEDULED",
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return _serialize(ev, db)


@router.get(
    "/events",
    response_model=List[CalendarEventOut],
    dependencies=[Depends(require("calendar.view"))],
)
def list_events(
    from_:       Optional[datetime] = Query(None, alias="from"),
    to:          Optional[datetime] = Query(None),
    owner_id:    Optional[str] = Query(None),
    lead_id:     Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    status:      Optional[str] = Query(None),
    event_type:  Optional[str] = Query(None),
    limit:       int  = Query(200, ge=1, le=1000),
    db:          Session = Depends(get_db),
    user:        dict    = Depends(get_current_user),
    vid:         int     = Depends(get_effective_vendor_id),
) -> List[CalendarEventOut]:

    q = db.query(CalendarEvent).filter(CalendarEvent.VENDOR_ID == vid)
    q = _scope_query(q, user)

    if from_:
        q = q.filter(CalendarEvent.END_AT   >= from_)
    if to:
        q = q.filter(CalendarEvent.START_AT <= to)
    if owner_id:
        q = q.filter(CalendarEvent.OWNER_ID == owner_id)
    if lead_id:
        q = q.filter(CalendarEvent.LEAD_ID == lead_id)
    if customer_id:
        q = q.filter(CalendarEvent.CUSTOMER_ID == customer_id)
    if status:
        q = q.filter(CalendarEvent.STATUS == status.upper())
    if event_type:
        q = q.filter(CalendarEvent.EVENT_TYPE == event_type.upper())

    rows = q.order_by(CalendarEvent.START_AT.asc()).limit(limit).all()
    return [_serialize(r, db) for r in rows]


@router.get(
    "/events/{event_id}",
    response_model=CalendarEventOut,
    dependencies=[Depends(require("calendar.view"))],
)
def get_event(
    event_id: str,
    db:       Session = Depends(get_db),
    user:     dict    = Depends(get_current_user),
    vid:      int     = Depends(get_effective_vendor_id),
) -> CalendarEventOut:

    q = db.query(CalendarEvent).filter(
        CalendarEvent.ID == event_id,
        CalendarEvent.VENDOR_ID == vid,
    )
    q = _scope_query(q, user)
    ev = q.first()
    if not ev:
        raise HTTPException(404, "Event not found")
    return _serialize(ev, db)


@router.patch(
    "/events/{event_id}",
    response_model=CalendarEventOut,
    dependencies=[Depends(require("calendar.manage"))],
)
def update_event(
    event_id: str,
    payload:  CalendarEventUpdate,
    db:       Session = Depends(get_db),
    user:     dict    = Depends(get_current_user),
    vid:      int     = Depends(get_effective_vendor_id),
) -> CalendarEventOut:

    q = db.query(CalendarEvent).filter(
        CalendarEvent.ID == event_id,
        CalendarEvent.VENDOR_ID == vid,
    )
    q = _scope_query(q, user)
    ev = q.first()
    if not ev:
        raise HTTPException(404, "Event not found")

    data = payload.model_dump(exclude_unset=True)

    # Cross-owner move — only team-view users
    if "owner_id" in data and data["owner_id"] != ev.OWNER_ID:
        if not _can_see_other_owners(user):
            raise HTTPException(403, "You can't reassign events to other owners.")

    field_map = {
        "title":            ("TITLE",            lambda v: v.strip() if v else v),
        "description":      ("DESCRIPTION",      lambda v: (v or "").strip() or None),
        "event_type":       ("EVENT_TYPE",       lambda v: v.upper() if v else v),
        "location":         ("LOCATION",         lambda v: (v or "").strip() or None),
        "start_at":         ("START_AT",         lambda v: v),
        "end_at":           ("END_AT",           lambda v: v),
        "all_day":          ("ALL_DAY",          lambda v: bool(v)),
        "owner_id":         ("OWNER_ID",         lambda v: v),
        "lead_id":          ("LEAD_ID",          lambda v: v),
        "customer_id":      ("CUSTOMER_ID",      lambda v: v),
        "reminder_minutes": ("REMINDER_MINUTES", lambda v: v),
        "notify_emails":    ("NOTIFY_EMAILS",    lambda v: (v or "").strip() or None),
        "status":           ("STATUS",           lambda v: v.upper() if v else v),
        "outcome_notes":    ("OUTCOME_NOTES",    lambda v: (v or "").strip() or None),
    }

    for key, val in data.items():
        if key == "attendee_ids":
            ev.ATTENDEE_IDS = _join_attendees(val)
            continue
        if key in field_map:
            col, transform = field_map[key]
            setattr(ev, col, transform(val))

    # Rescheduling → allow reminder to fire again
    if "start_at" in data or "reminder_minutes" in data:
        ev.REMINDER_SENT = False

    db.commit()
    db.refresh(ev)
    return _serialize(ev, db)


@router.post(
    "/events/{event_id}/complete",
    response_model=CalendarEventOut,
    dependencies=[Depends(require("calendar.manage"))],
)
def complete_event(
    event_id: str,
    payload:  CalendarEventComplete,
    db:       Session = Depends(get_db),
    user:     dict    = Depends(get_current_user),
    vid:      int     = Depends(get_effective_vendor_id),
) -> CalendarEventOut:

    q = db.query(CalendarEvent).filter(
        CalendarEvent.ID == event_id,
        CalendarEvent.VENDOR_ID == vid,
    )
    q = _scope_query(q, user)
    ev = q.first()
    if not ev:
        raise HTTPException(404, "Event not found")

    ev.STATUS = "COMPLETED"
    if payload.outcome_notes is not None:
        ev.OUTCOME_NOTES = payload.outcome_notes.strip() or None

    db.commit()
    db.refresh(ev)
    return _serialize(ev, db)


@router.delete(
    "/events/{event_id}",
    dependencies=[Depends(require("calendar.manage"))],
)
def delete_event(
    event_id: str,
    hard:     bool = Query(False, description="hard=true really removes the row"),
    db:       Session = Depends(get_db),
    user:     dict    = Depends(get_current_user),
    vid:      int     = Depends(get_effective_vendor_id),
) -> Dict[str, Any]:

    q = db.query(CalendarEvent).filter(
        CalendarEvent.ID == event_id,
        CalendarEvent.VENDOR_ID == vid,
    )
    q = _scope_query(q, user)
    ev = q.first()
    if not ev:
        raise HTTPException(404, "Event not found")

    if hard:
        db.delete(ev)
        db.commit()
        return {"deleted": True, "hard": True, "id": event_id}

    ev.STATUS = "CANCELLED"
    db.commit()
    return {"deleted": True, "hard": False, "id": event_id}


# ---------------------------------------------------------------------
# Widgets + reminder scan
# ---------------------------------------------------------------------

@router.get(
    "/upcoming",
    response_model=List[CalendarEventOut],
    dependencies=[Depends(require("calendar.view"))],
)
def upcoming(
    owner_id: Optional[str] = Query(None),
    limit:    int  = Query(10, ge=1, le=100),
    db:       Session = Depends(get_db),
    user:     dict    = Depends(get_current_user),
    vid:      int     = Depends(get_effective_vendor_id),
) -> List[CalendarEventOut]:

    now = datetime.now()
    q = db.query(CalendarEvent).filter(
        CalendarEvent.VENDOR_ID == vid,
        CalendarEvent.STATUS == "SCHEDULED",
        CalendarEvent.END_AT >= now,
    )
    q = _scope_query(q, user)
    if owner_id:
        q = q.filter(CalendarEvent.OWNER_ID == owner_id)
    else:
        emp_id = user.get("employee_id") or user.get("sub")
        if emp_id and not _can_see_other_owners(user):
            # already scoped; nothing extra
            pass

    rows = q.order_by(CalendarEvent.START_AT.asc()).limit(limit).all()
    return [_serialize(r, db) for r in rows]


@router.get(
    "/team",
    response_model=List[CalendarEventOut],
    dependencies=[Depends(require("calendar.team_view"))],
)
def team_calendar(
    from_:  Optional[datetime] = Query(None, alias="from"),
    to:     Optional[datetime] = Query(None),
    owners: Optional[List[str]] = Query(None, description="owner employee ids"),
    limit:  int = Query(500, ge=1, le=2000),
    db:     Session = Depends(get_db),
    vid:    int     = Depends(get_effective_vendor_id),
) -> List[CalendarEventOut]:

    q = db.query(CalendarEvent).filter(CalendarEvent.VENDOR_ID == vid)
    if from_: q = q.filter(CalendarEvent.END_AT   >= from_)
    if to:    q = q.filter(CalendarEvent.START_AT <= to)
    if owners:
        q = q.filter(CalendarEvent.OWNER_ID.in_(owners))

    rows = q.order_by(CalendarEvent.OWNER_ID.asc(),
                      CalendarEvent.START_AT.asc()).limit(limit).all()
    return [_serialize(r, db) for r in rows]


@router.post("/scan-reminders")
def scan_reminders(
    db:  Session = Depends(get_db),
    vid: int = Depends(get_effective_vendor_id),
) -> Dict[str, Any]:
    """Called by the scheduler every few minutes. Finds SCHEDULED
    events whose start time is inside `now + reminder_minutes`, creates
    a Notification row for the owner, and marks REMINDER_SENT so we
    don't spam the same event again.

    Also exposed as a POST so an admin can force-run it from Swagger
    when testing (`Try it out`).
    """
    return _scan_reminders_impl(db, vendor_id=vid)


def _scan_reminders_impl(db: Session, vendor_id: Optional[int] = None) -> Dict[str, Any]:
    """Vendor-scoped when called from the API; when the scheduler
    invokes it directly (see scheduler.py) we pass vendor_id=None so
    every tenant is processed in one sweep."""
    now = datetime.now()

    # Event needs a reminder if EITHER an owner (in-app) OR at least
    # one notify email is set. Relaxed from Phase 1's owner-only rule
    # so external-only reminders (e.g. remind a customer contact) work.
    q = db.query(CalendarEvent).filter(
        CalendarEvent.STATUS == "SCHEDULED",
        CalendarEvent.REMINDER_SENT == False,           # noqa: E712
        CalendarEvent.REMINDER_MINUTES > 0,
    )
    if vendor_id is not None:
        q = q.filter(CalendarEvent.VENDOR_ID == vendor_id)

    fired = 0
    for ev in q.limit(500).all():
        reminder_at = ev.START_AT - timedelta(minutes=int(ev.REMINDER_MINUTES or 0))
        if now < reminder_at:
            continue                                     # not yet due
        if ev.START_AT < now - timedelta(hours=6):
            # Event already 6h+ in the past — skip and mark sent so it
            # doesn't loop.
            ev.REMINDER_SENT = True
            continue

        mins_to_start = max(0, int((ev.START_AT - now).total_seconds() // 60))
        window = (
            f"in {mins_to_start} minute{'s' if mins_to_start != 1 else ''}"
            if mins_to_start else "now"
        )

        # ---- In-app notification (owner) ----
        if ev.OWNER_ID:
            db.add(Notification(
                EMPLOYEE_ID = ev.OWNER_ID,
                TITLE       = f"{ev.EVENT_TYPE.title()}: {ev.TITLE}",
                MESSAGE     = (
                    f"Starts {window} — "
                    f"{ev.START_AT.strftime('%d %b %H:%M')} to "
                    f"{ev.END_AT.strftime('%H:%M')}"
                    f"{' · ' + ev.LOCATION if ev.LOCATION else ''}"
                )[:500],
                TYPE        = "CALENDAR_REMINDER",
                IS_READ     = 0,
                VENDOR_ID   = ev.VENDOR_ID,
                REF_TYPE    = "CALENDAR_EVENT",
                REF_ID      = None,   # REF_ID is INT; event ID is UUID
            ))

        # ---- Email reminders — one per address in NOTIFY_EMAILS ----
        # Uses the existing email service so it picks up the vendor's
        # SMTP config (falls back to Resend if configured). Best-effort:
        # per-address failures are logged but do not roll the whole
        # scan back. If NO email channel is configured this returns
        # False silently, which is fine — in-app still worked.
        if ev.NOTIFY_EMAILS:
            addrs = [
                a.strip() for a in ev.NOTIFY_EMAILS.split(",")
                if a and "@" in a and "." in a
            ]
            if addrs:
                _send_reminder_email(ev, addrs, mins_to_start)

        ev.REMINDER_SENT = True
        fired += 1

    db.commit()
    return {"fired": fired, "checked_at": now.isoformat()}


def _send_reminder_email(ev: CalendarEvent, addrs: List[str], mins_to_start: int) -> None:
    """Send a plain-text-friendly HTML reminder to every address in
    `addrs`. Runs inside the reminder scheduler; must NEVER raise —
    any failure is swallowed so the SCHEDULED event still gets
    marked REMINDER_SENT and the loop moves on."""
    import logging
    log = logging.getLogger("uvicorn.error")

    subject = f"Reminder: {ev.EVENT_TYPE.title()} — {ev.TITLE}"
    window  = (f"starts in {mins_to_start} minute{'s' if mins_to_start != 1 else ''}"
               if mins_to_start else "starts now")

    location_html = (
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b;">Where</td>'
        f'<td><strong>{ev.LOCATION}</strong></td></tr>'
    ) if ev.LOCATION else ""

    notes_html = (
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;">Notes</td>'
        f'<td>{ev.DESCRIPTION}</td></tr>'
    ) if ev.DESCRIPTION else ""

    body_html = f"""<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
  <div style="border-left:4px solid #C8102E;padding:12px 16px;background:#fef2f2;border-radius:6px;margin-bottom:16px;">
    <strong>BVC24 Calendar reminder</strong> — this {ev.EVENT_TYPE.lower()} {window}.
  </div>

  <h2 style="margin:0 0 8px 0;color:#7A1022;">{ev.TITLE}</h2>

  <table style="border-collapse:collapse;font-size:14px;margin-top:12px;">
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Type</td>
        <td><strong>{ev.EVENT_TYPE}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">When</td>
        <td><strong>{ev.START_AT.strftime('%A, %d %B %Y · %H:%M')} – {ev.END_AT.strftime('%H:%M')}</strong></td></tr>
    {location_html}
    {notes_html}
  </table>

  <p style="margin-top:22px;font-size:12px;color:#94a3b8;">
    This is an automatic reminder from Bharath Vending Corporation's ERP calendar.
    You received it because you were added to the "notify by email" list for this event.
  </p>
</body></html>
"""

    # Try vendor SMTP first, fall back to Resend if configured.
    try:
        from app.services.email_service import send_via_resend, send_via_vendor_smtp
        from app.models.email_models import VendorEmailConfig
        from app.database.database import SessionLocal
    except Exception as e:
        log.warning("[calendar-reminder-email] email service unavailable: %s", e)
        return

    db2 = SessionLocal()
    try:
        active_cfgs = (
            db2.query(VendorEmailConfig)
               .filter(
                   VendorEmailConfig.VENDOR_ID == ev.VENDOR_ID,
                   VendorEmailConfig.IS_ACTIVE == True,
               )
               .all()
        ) if ev.VENDOR_ID else []
    except Exception:
        active_cfgs = []
    finally:
        db2.close()

    for addr in addrs:
        sent = False
        for cfg in active_cfgs:
            try:
                ok, _err, _detail = send_via_vendor_smtp(cfg, addr, subject, body_html)
                if ok:
                    sent = True
                    break
            except Exception as e:
                log.warning("[calendar-reminder-email] vendor SMTP failed for %s: %s", addr, e)
        if not sent:
            try:
                send_via_resend(subject=subject, body_html=body_html, recipient=addr)
                sent = True
            except Exception as e:
                log.warning("[calendar-reminder-email] Resend failed for %s: %s: %s", addr, type(e).__name__, e)
        if sent:
            log.info("[calendar-reminder-email] sent to %s for event %s", addr, ev.ID)
