"""
Holiday Calendar — admin CRUD for vendor-scoped non-working days.

Endpoints
---------
  GET    /holidays                  List holidays for a year (default: current)
  POST   /holidays                  Create one holiday
  PATCH  /holidays/{holiday_id}     Update name/type/notes
  DELETE /holidays/{holiday_id}     Remove a holiday

  POST   /holidays/seed-india       Seed 12 Indian national holidays for a year
                                    (idempotent — won't duplicate existing dates)

Used by
-------
  payroll_service._working_days_in_month()
  star_performance_service._working_days_in_month()
"""

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import HolidayCalendar
from app.auth.auth_bearer import get_current_admin

router = APIRouter(prefix="/holidays", tags=["Holidays"])


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------

class HolidayCreate(BaseModel):
    HOLIDAY_DATE: date
    NAME:         str  = Field(..., min_length=1, max_length=120)
    TYPE:         str  = Field("NATIONAL", pattern="^(NATIONAL|REGIONAL|COMPANY)$")
    IS_OPTIONAL:  bool = False
    NOTES:        Optional[str] = None
    VENDOR_ID:    int  = 1


class HolidayUpdate(BaseModel):
    NAME:        Optional[str]  = None
    TYPE:        Optional[str]  = Field(None, pattern="^(NATIONAL|REGIONAL|COMPANY)$")
    IS_OPTIONAL: Optional[bool] = None
    NOTES:       Optional[str]  = None


def _serialize(h: HolidayCalendar) -> dict:
    return {
        "ID":            h.ID,
        "HOLIDAY_DATE":  h.HOLIDAY_DATE.isoformat() if h.HOLIDAY_DATE else None,
        "NAME":          h.NAME,
        "TYPE":          h.TYPE,
        "IS_OPTIONAL":   bool(h.IS_OPTIONAL),
        "NOTES":         h.NOTES,
        "VENDOR_ID":     h.VENDOR_ID,
        "CREATED_AT":    h.CREATED_AT.isoformat() if h.CREATED_AT else None,
    }


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------

@router.get("")
def list_holidays(
    year:      Optional[int] = Query(None, description="Defaults to current year"),
    vendor_id: int           = 1,
    db: Session              = Depends(get_db),
):
    """Holidays for a given year, sorted by date. Used by both the admin
    page and the payroll engine."""

    if year is None:
        year = date.today().year

    rows = (
        db.query(HolidayCalendar)
          .filter(
              HolidayCalendar.VENDOR_ID == vendor_id,
              HolidayCalendar.HOLIDAY_DATE >= date(year, 1, 1),
              HolidayCalendar.HOLIDAY_DATE <= date(year, 12, 31),
          )
          .order_by(HolidayCalendar.HOLIDAY_DATE)
          .all()
    )

    return {
        "year":     year,
        "total":    len(rows),
        "holidays": [_serialize(h) for h in rows],
    }


@router.post("", dependencies=[Depends(get_current_admin)])
def create_holiday(
    data: HolidayCreate,
    db:   Session = Depends(get_db),
):
    """Add one holiday. Date+vendor uniqueness is enforced at the DB
    level — duplicates return 409."""

    exists = (
        db.query(HolidayCalendar)
          .filter(
              HolidayCalendar.VENDOR_ID == data.VENDOR_ID,
              HolidayCalendar.HOLIDAY_DATE == data.HOLIDAY_DATE,
          )
          .first()
    )

    if exists:
        raise HTTPException(
            status_code=409,
            detail=f"{data.HOLIDAY_DATE} is already a holiday ({exists.NAME})",
        )

    h = HolidayCalendar(
        HOLIDAY_DATE=data.HOLIDAY_DATE,
        NAME=data.NAME.strip()[:120],
        TYPE=data.TYPE,
        IS_OPTIONAL=1 if data.IS_OPTIONAL else 0,
        NOTES=(data.NOTES or "").strip()[:500] or None,
        VENDOR_ID=data.VENDOR_ID,
    )

    db.add(h)

    db.commit()

    db.refresh(h)

    return {"message": "Holiday added", "holiday": _serialize(h)}


@router.patch("/{holiday_id}", dependencies=[Depends(get_current_admin)])
def update_holiday(
    holiday_id: int,
    data:       HolidayUpdate,
    db:         Session = Depends(get_db),
):

    h = db.query(HolidayCalendar).filter(HolidayCalendar.ID == holiday_id).first()

    if not h:
        raise HTTPException(404, "Holiday not found")

    payload = data.model_dump(exclude_unset=True)

    if "IS_OPTIONAL" in payload:
        payload["IS_OPTIONAL"] = 1 if payload["IS_OPTIONAL"] else 0

    for field, value in payload.items():
        setattr(h, field, value)

    db.commit()

    return {"message": "Holiday updated", "holiday": _serialize(h)}


@router.delete("/{holiday_id}", dependencies=[Depends(get_current_admin)])
def delete_holiday(
    holiday_id: int,
    db:         Session = Depends(get_db),
):

    h = db.query(HolidayCalendar).filter(HolidayCalendar.ID == holiday_id).first()

    if not h:
        raise HTTPException(404, "Holiday not found")

    db.delete(h)

    db.commit()

    return {"message": "Holiday deleted"}


# ---------------------------------------------------------------------
# Bulk seed — Indian national holidays
# ---------------------------------------------------------------------

# Canonical Indian national holidays. Dates that shift by lunar/solar
# calendar (Diwali, Holi, Eid, etc.) are listed for the seeded year
# explicitly. Add new years here as needed.
INDIA_NATIONAL_HOLIDAYS = {
    2026: [
        ("2026-01-01", "New Year's Day",        "NATIONAL"),
        ("2026-01-14", "Pongal / Sankranti",    "NATIONAL"),
        ("2026-01-26", "Republic Day",          "NATIONAL"),
        ("2026-03-04", "Holi",                  "NATIONAL"),
        ("2026-03-21", "Ramadan / Eid al-Fitr", "NATIONAL"),
        ("2026-04-10", "Good Friday",           "NATIONAL"),
        ("2026-04-14", "Tamil New Year",        "REGIONAL"),
        ("2026-05-27", "Eid al-Adha",           "NATIONAL"),
        ("2026-08-15", "Independence Day",      "NATIONAL"),
        ("2026-08-26", "Janmashtami",           "NATIONAL"),
        ("2026-10-02", "Gandhi Jayanti",        "NATIONAL"),
        ("2026-10-20", "Diwali",                "NATIONAL"),
        ("2026-12-25", "Christmas Day",         "NATIONAL"),
    ],
    2025: [
        ("2025-01-01", "New Year's Day",        "NATIONAL"),
        ("2025-01-14", "Pongal / Sankranti",    "NATIONAL"),
        ("2025-01-26", "Republic Day",          "NATIONAL"),
        ("2025-03-14", "Holi",                  "NATIONAL"),
        ("2025-03-31", "Eid al-Fitr",           "NATIONAL"),
        ("2025-04-14", "Tamil New Year",        "REGIONAL"),
        ("2025-04-18", "Good Friday",           "NATIONAL"),
        ("2025-06-07", "Eid al-Adha",           "NATIONAL"),
        ("2025-08-15", "Independence Day",      "NATIONAL"),
        ("2025-08-16", "Janmashtami",           "NATIONAL"),
        ("2025-10-02", "Gandhi Jayanti",        "NATIONAL"),
        ("2025-10-20", "Diwali",                "NATIONAL"),
        ("2025-12-25", "Christmas Day",         "NATIONAL"),
    ],
}


@router.post("/seed-india", dependencies=[Depends(get_current_admin)])
def seed_india_national(
    year:      int = Query(..., description="Year to seed, e.g. 2026"),
    vendor_id: int = 1,
    db:        Session = Depends(get_db),
):
    """Idempotently insert the canonical Indian national holiday list
    for the year. Dates already in the DB are left alone."""

    catalog = INDIA_NATIONAL_HOLIDAYS.get(year)

    if not catalog:
        raise HTTPException(
            status_code=400,
            detail=f"No canonical holiday list bundled for {year}. "
                   f"Add entries to holiday.INDIA_NATIONAL_HOLIDAYS first."
        )

    added = 0
    skipped = 0

    for iso, name, htype in catalog:

        d = date.fromisoformat(iso)

        exists = (
            db.query(HolidayCalendar)
              .filter(
                  HolidayCalendar.VENDOR_ID == vendor_id,
                  HolidayCalendar.HOLIDAY_DATE == d,
              )
              .first()
        )

        if exists:
            skipped += 1
            continue

        db.add(HolidayCalendar(
            HOLIDAY_DATE=d,
            NAME=name,
            TYPE=htype,
            IS_OPTIONAL=0,
            VENDOR_ID=vendor_id,
        ))

        added += 1

    db.commit()

    return {
        "message": f"Seeded {year} Indian holidays",
        "added": added,
        "skipped_already_present": skipped,
    }
