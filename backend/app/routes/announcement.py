"""
Announcement endpoints — HR-authored posts (Meeting / Event / Notice)
that show up in the ESS Announcements panel.

  GET    /announcements                 -> list (filters: type, upcoming, vendor)
  POST   /announcements                 -> create (admin only)
  PATCH  /announcements/{id}            -> update (admin only)
  DELETE /announcements/{id}            -> soft-delete (admin only)

Notification integration: creating an announcement optionally spawns a
Notification row for every active employee in the vendor. Each row
carries the target EMPLOYEE_ID so the per-employee bell scoping we
just added continues to work correctly.
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import require, get_current_user
from app.models.models import Announcement, AnnouncementRead, Employee, Notification


router = APIRouter(prefix="/announcements", tags=["Announcements"])


# Twelve category buckets covering the announcement space HR uses in
# practice. NOTICE kept as an alias for GENERAL so any rows written
# by the earlier three-type version stay valid — normalize on read
# in the frontend if you need consistency.
ALLOWED_TYPES = {
    "GENERAL",         # Policies, procedures, reminders, org updates
    "HR",              # New hires, promotions, benefits, leave policy, training
    "MEETING",         # Team / department meetings, town halls
    "EVENT",           # Parties, celebrations, engagement activities
    "HOLIDAY",         # Holiday schedules, closures, greetings
    "SAFETY",          # Safety & security notices, drills
    "IT",              # System maintenance, software updates, downtime
    "ACHIEVEMENT",     # Milestones, awards, recognitions
    "OPERATIONAL",     # Process changes, relocations, new equipment
    "URGENT",          # Emergency / immediate action required
    "COMMUNICATION",   # Surveys, feedback requests, internal campaigns
    "CORPORATE",       # Strategy, leadership changes, mergers
    "NOTICE",          # Legacy alias — treat as GENERAL going forward
}

# Types that carry a scheduled date/time. All others are dateless.
DATED_TYPES = {"MEETING", "EVENT", "HOLIDAY"}


# ============================================================
# Schemas
# ============================================================

class AnnouncementIn(BaseModel):
    """Payload for both POST and PATCH. PATCH ignores unset fields."""

    TYPE: Optional[str] = Field(None, description="MEETING | EVENT | NOTICE")
    TITLE: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    EVENT_DATE: Optional[str] = Field(None, description="YYYY-MM-DD")
    EVENT_TIME: Optional[str] = Field(None, description="HH:MM")
    LOCATION: Optional[str] = None


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="EVENT_DATE must be YYYY-MM-DD",
        )


def _serialize(row: Announcement) -> dict:
    return {
        "ID": row.ID,
        "TYPE": row.TYPE,
        "TITLE": row.TITLE,
        "DESCRIPTION": row.DESCRIPTION,
        "EVENT_DATE": row.EVENT_DATE.isoformat() if row.EVENT_DATE else None,
        "EVENT_TIME": row.EVENT_TIME,
        "LOCATION": row.LOCATION,
        "IS_ACTIVE": bool(row.IS_ACTIVE),
        "CREATED_BY_ID": row.CREATED_BY_ID,
        "CREATED_AT": row.CREATED_AT.isoformat() if row.CREATED_AT else None,
        "UPDATED_AT": row.UPDATED_AT.isoformat() if row.UPDATED_AT else None,
        "VENDOR_ID": row.VENDOR_ID,
    }


# ============================================================
# LIST — everyone in the vendor can read
# ============================================================

@router.get("")
def list_announcements(
    type: Optional[str] = Query(
        None,
        description="One of the ALLOWED_TYPES values, omit for all.",
    ),
    upcoming_only: bool = Query(
        False,
        description=(
            "If true, hide dated rows whose EVENT_DATE is in the past. "
            "Dateless rows are unaffected."
        ),
    ),
    include_inactive: bool = Query(False),
    vendor_id: Optional[int] = Query(
        None,
        description=(
            "Admins can pass this to cross-scope; regular employees "
            "have it silently overwritten with their JWT vendor_id."
        ),
    ),
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List announcements the caller is allowed to see.

    Vendor scoping is enforced from the caller's JWT — announcements
    never leak across vendors. An admin-role caller (ADMIN /
    SUPER_ADMIN) can override the vendor_id query param to inspect
    another vendor; everyone else has it clamped to their own vendor.
    """

    caller_vendor = payload.get("vendor_id") or 1
    caller_role   = (payload.get("role") or "").upper()
    is_admin      = caller_role in {"ADMIN", "SUPER_ADMIN"}

    # Non-admins can NEVER see other vendors' announcements. Admins
    # can pass a different vendor_id to inspect if they need to.
    effective_vendor = vendor_id if (is_admin and vendor_id is not None) else caller_vendor

    q = db.query(Announcement).filter(Announcement.VENDOR_ID == effective_vendor)

    if not include_inactive:
        q = q.filter(Announcement.IS_ACTIVE == 1)

    if type:
        t = type.upper()
        if t not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"type must be one of {sorted(ALLOWED_TYPES)}",
            )
        q = q.filter(Announcement.TYPE == t)

    if upcoming_only:
        # Rows with no EVENT_DATE (NOTICE type) stay in; rows with an
        # EVENT_DATE only pass if the date is today or later.
        today = date.today()
        q = q.filter(
            (Announcement.EVENT_DATE == None)   # noqa: E711 — SQL comparison
            | (Announcement.EVENT_DATE >= today)
        )

    # Ordering: newest first by CREATED_AT. That works uniformly for
    # dated and dateless types, and it's what employees expect on an
    # 'announcements' surface — freshest post at the top. Attempting
    # to sort dated rows by EVENT_DATE first ran into MySQL / SQLAlchemy
    # nulls-last quirks; a plain CREATED_AT desc is boring and robust.
    rows = (
        q.order_by(Announcement.CREATED_AT.desc())
         .limit(500)
         .all()
    )

    return [_serialize(r) for r in rows]


# ============================================================
# CREATE — admin only
# ============================================================

@router.post("", dependencies=[Depends(require("announcement.manage"))])
def create_announcement(
    body: AnnouncementIn,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    a_type = (body.TYPE or "").upper()
    if a_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"TYPE must be one of {sorted(ALLOWED_TYPES)}",
        )

    title = (body.TITLE or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="TITLE is required")

    # Vendor derived from the caller's JWT — announcements never
    # cross vendors.
    vendor_id = payload.get("vendor_id") or 1

    row = Announcement(
        VENDOR_ID=vendor_id,
        TYPE=a_type,
        TITLE=title[:200],
        DESCRIPTION=(body.DESCRIPTION or "").strip()[:2000] or None,
        EVENT_DATE=_parse_date(body.EVENT_DATE),
        EVENT_TIME=(body.EVENT_TIME or "").strip()[:10] or None,
        LOCATION=(body.LOCATION or "").strip()[:200] or None,
        CREATED_BY_ID=payload.get("employee_id"),
        IS_ACTIVE=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Fan out one Notification row per active employee in the vendor.
    # Best-effort: a failure here must not roll back the announcement.
    try:
        emps = (
            db.query(Employee)
            .filter(Employee.VENDOR_ID == vendor_id)
            .filter(Employee.STATUS == "ACTIVE")
            .all()
        )

        # URGENT and SAFETY get the amber WARNING band on the toast +
        # bell dot so employees see they're not routine posts.
        notif_type = (
            "WARNING" if a_type in {"URGENT", "SAFETY"}
            else "SUCCESS" if a_type == "ACHIEVEMENT"
            else "INFO"
        )
        # Human-readable label — 'HR', 'IT' stay uppercase; the rest
        # title-case.
        type_label = a_type if a_type in {"HR", "IT"} else a_type.title()
        notif_title = f"{type_label}: {title[:80]}"
        notif_msg_parts = [title]
        if row.EVENT_DATE:
            notif_msg_parts.append(row.EVENT_DATE.strftime("%d %b %Y"))
        if row.EVENT_TIME:
            notif_msg_parts.append(row.EVENT_TIME)
        if row.LOCATION:
            notif_msg_parts.append(row.LOCATION)
        notif_msg = " · ".join(notif_msg_parts)[:500]

        for emp in emps:
            db.add(Notification(
                EMPLOYEE_ID=emp.ID,
                TITLE=notif_title[:150],
                MESSAGE=notif_msg,
                TYPE=notif_type,
                VENDOR_ID=vendor_id,
                # Backlink so DELETE announcement can also delete the
                # notifications it spawned. Keeps the bell tidy when
                # HR cancels a post.
                REF_TYPE="ANNOUNCEMENT",
                REF_ID=row.ID,
            ))
        db.commit()
    except Exception:
        db.rollback()

    return {"message": "Announcement created", "announcement": _serialize(row)}


# ============================================================
# UPDATE — admin only
# ============================================================

@router.patch("/{ann_id}", dependencies=[Depends(require("announcement.manage"))])
def update_announcement(
    ann_id: int,
    body: AnnouncementIn,
    db: Session = Depends(get_db),
):

    row = db.query(Announcement).filter(Announcement.ID == ann_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")

    if body.TYPE is not None:
        t = body.TYPE.upper()
        if t not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"TYPE must be one of {sorted(ALLOWED_TYPES)}",
            )
        row.TYPE = t

    if body.TITLE is not None:
        title = body.TITLE.strip()
        if not title:
            raise HTTPException(status_code=400, detail="TITLE cannot be empty")
        row.TITLE = title[:200]

    if body.DESCRIPTION is not None:
        row.DESCRIPTION = body.DESCRIPTION.strip()[:2000] or None

    if body.EVENT_DATE is not None:
        row.EVENT_DATE = _parse_date(body.EVENT_DATE)

    if body.EVENT_TIME is not None:
        row.EVENT_TIME = body.EVENT_TIME.strip()[:10] or None

    if body.LOCATION is not None:
        row.LOCATION = body.LOCATION.strip()[:200] or None

    db.commit()
    db.refresh(row)

    return {"message": "Announcement updated", "announcement": _serialize(row)}


# ============================================================
# DELETE — soft delete, admin only
# ============================================================

@router.delete("/{ann_id}", dependencies=[Depends(require("announcement.manage"))])
def delete_announcement(
    ann_id: int,
    db: Session = Depends(get_db),
):

    row = db.query(Announcement).filter(Announcement.ID == ann_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")

    row.IS_ACTIVE = 0

    # Also clear the notifications that were fanned out when this
    # announcement was posted, so employee bells don't keep showing a
    # message that has been officially withdrawn.
    (
        db.query(Notification)
        .filter(Notification.REF_TYPE == "ANNOUNCEMENT")
        .filter(Notification.REF_ID == ann_id)
        .delete(synchronize_session=False)
    )

    db.commit()

    return {"message": "Announcement removed"}


# ---------------------------------------------------------------------
# Read receipts — who saw which announcement.
# ---------------------------------------------------------------------
# Employee's Announcements panel calls /mark-read the moment they open
# an announcement (or scroll past it in their feed). Idempotent — the
# unique (announcement_id, employee_id) constraint means a second call
# is a no-op. Admin's Announcements page calls /receipts to see how
# many people have actually read it.

@router.post("/{ann_id}/mark-read")
def mark_announcement_read(
    ann_id: int,
    db:   Session = Depends(get_db),
    user: dict    = Depends(get_current_user),
):
    """Record that the current employee has read this announcement.
    Called by the ESS Announcements panel on view/expand."""
    emp_id = user.get("employee_id") or user.get("sub")
    if not emp_id:
        # Not an employee session (e.g. Root) — nothing to record.
        return {"recorded": False, "reason": "no employee context"}

    if not db.query(Announcement).filter(
        Announcement.ID == ann_id,
        Announcement.IS_ACTIVE == 1,
    ).first():
        raise HTTPException(404, "Announcement not found")

    # Insert-or-ignore. SQLAlchemy has no cross-DB "on duplicate ignore",
    # so we probe first — cheap because both columns are indexed.
    exists = db.query(AnnouncementRead).filter(
        AnnouncementRead.ANNOUNCEMENT_ID == ann_id,
        AnnouncementRead.EMPLOYEE_ID     == emp_id,
    ).first()
    if exists:
        return {"recorded": True, "already": True, "at": exists.READ_AT.isoformat()}

    row = AnnouncementRead(ANNOUNCEMENT_ID=ann_id, EMPLOYEE_ID=emp_id)
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        # Race: another tab of the same user just recorded it. Fine.
        return {"recorded": True, "raced": True}
    return {"recorded": True, "at": row.READ_AT.isoformat()}


@router.get(
    "/{ann_id}/receipts",
    dependencies=[Depends(require("announcement.manage"))],
)
def get_receipts(ann_id: int, db: Session = Depends(get_db)):
    """Admin view — who has read this announcement + total-eligible
    count so the UI can show "45 of 100 read"."""
    ann = db.query(Announcement).filter(Announcement.ID == ann_id).first()
    if not ann:
        raise HTTPException(404, "Announcement not found")

    # Everyone in the same vendor + ACTIVE = eligible reader count.
    total_eligible = (
        db.query(Employee)
        .filter(
            Employee.VENDOR_ID == ann.VENDOR_ID,
            (Employee.STATUS == None) | (Employee.STATUS == "ACTIVE"),  # noqa: E711
        )
        .count()
    )

    reads = (
        db.query(AnnouncementRead, Employee)
        .join(Employee, Employee.ID == AnnouncementRead.EMPLOYEE_ID)
        .filter(AnnouncementRead.ANNOUNCEMENT_ID == ann_id)
        .order_by(AnnouncementRead.READ_AT.desc())
        .all()
    )

    return {
        "announcement_id":  ann_id,
        "title":            ann.TITLE,
        "read_count":       len(reads),
        "total_eligible":   total_eligible,
        "readers": [
            {
                "employee_id":   emp.ID,
                "employee_code": emp.EMPLOYEE_CODE,
                "name":          emp.NAME,
                "read_at":       ar.READ_AT.isoformat(),
            }
            for ar, emp in reads
        ],
    }


@router.get(
    "/receipts/summary",
    dependencies=[Depends(require("announcement.manage"))],
)
def receipts_summary(db: Session = Depends(get_db)):
    """One-line read-count per active announcement for the admin list
    page — 'HR townhall — 12/40', 'Diwali holiday notice — 38/40'."""
    from sqlalchemy import func
    rows = (
        db.query(
            Announcement.ID,
            Announcement.TITLE,
            Announcement.VENDOR_ID,
            func.count(AnnouncementRead.ID).label("read_count"),
        )
        .outerjoin(AnnouncementRead, AnnouncementRead.ANNOUNCEMENT_ID == Announcement.ID)
        .filter(Announcement.IS_ACTIVE == 1)
        .group_by(Announcement.ID, Announcement.TITLE, Announcement.VENDOR_ID)
        .order_by(Announcement.CREATED_AT.desc())
        .all()
    )
    if not rows:
        return []

    # Compute active-employee counts once per vendor for the "of N" side.
    vendor_ids = {r.VENDOR_ID for r in rows}
    from app.models.models import Employee as _E
    from sqlalchemy import func as _f
    eligible = dict(
        db.query(_E.VENDOR_ID, _f.count(_E.ID))
          .filter(_E.VENDOR_ID.in_(vendor_ids))
          .filter((_E.STATUS == None) | (_E.STATUS == "ACTIVE"))  # noqa: E711
          .group_by(_E.VENDOR_ID)
          .all()
    )
    return [
        {
            "announcement_id":  r.ID,
            "title":            r.TITLE,
            "read_count":       int(r.read_count or 0),
            "total_eligible":   int(eligible.get(r.VENDOR_ID, 0)),
        }
        for r in rows
    ]
