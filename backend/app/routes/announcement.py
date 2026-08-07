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
from app.models.models import Announcement, Employee, Notification


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
        description="MEETING | EVENT | NOTICE — omit for all types.",
    ),
    upcoming_only: bool = Query(
        False,
        description=(
            "If true, hide MEETING / EVENT rows whose EVENT_DATE is in "
            "the past. NOTICE rows are unaffected (they have no date)."
        ),
    ),
    include_inactive: bool = Query(False),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):

    q = db.query(Announcement)

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

    if vendor_id is not None:
        q = q.filter(Announcement.VENDOR_ID == vendor_id)

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
    db.commit()

    return {"message": "Announcement removed"}
