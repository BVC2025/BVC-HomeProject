"""
working_days_service.py  —  Source of truth for "how many working days
are in a given (year, month, vendor)" question.

Replaces every previous hardcoded `26` in payroll and star-performance
math. The answer is:
    total days in month
    − Sundays (always off)
    − HolidayCalendar rows for that vendor that fall in the month
    − optional holidays (only when explicitly toggled on)

Edge cases handled:
  * Saturdays are working days for BVC24 — no exclusion.
  * Mark a Saturday as off by adding a HolidayCalendar row for it.
  * Past months: same formula; the holiday list is point-in-time data
    but since pay runs snapshot WORKING_DAYS onto the slip, retroactive
    calendar edits don't rewrite historic slips.
"""

import calendar
from datetime import date
from typing import Iterable, List, Set, Tuple

from sqlalchemy.orm import Session

from app.models.models import HolidayCalendar


def working_days_in_month(
    db: Session,
    year: int,
    month: int,
    vendor_id: int = 1,
    include_optional: bool = False,
) -> int:
    """Return the number of working days for the given month and vendor.

    Args:
        db: SQLAlchemy session.
        year, month: pay period.
        vendor_id: company scope (BVC default = 1).
        include_optional: if True, even optional holidays are
            subtracted (e.g. when a worker confirms they took them).

    Default behavior: Sundays + mandatory holidays excluded.
    """

    first, last = _month_range(year, month)

    holiday_dates = _holiday_dates_in(db, first, last, vendor_id, include_optional)

    total = 0

    d = first
    one_day = (date(year, month, 2) - date(year, month, 1))

    while d <= last:

        # Sunday → off (weekday() returns 6 for Sun in Python)
        is_sunday = d.weekday() == 6

        is_holiday = d in holiday_dates

        if not is_sunday and not is_holiday:
            total += 1

        d = d + one_day

    return total


def list_working_dates(
    db: Session,
    year: int,
    month: int,
    vendor_id: int = 1,
    include_optional: bool = False,
) -> List[date]:
    """Same logic as `working_days_in_month` but returns the actual
    list of date objects. Used by attendance computations that need
    to iterate each working day."""

    first, last = _month_range(year, month)

    holiday_dates = _holiday_dates_in(db, first, last, vendor_id, include_optional)

    out: List[date] = []

    d = first
    one_day = (date(year, month, 2) - date(year, month, 1))

    while d <= last:

        if d.weekday() != 6 and d not in holiday_dates:
            out.append(d)

        d = d + one_day

    return out


# ---------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------

def _month_range(year: int, month: int) -> Tuple[date, date]:

    first = date(year, month, 1)

    last_dom = calendar.monthrange(year, month)[1]

    return first, date(year, month, last_dom)


def _holiday_dates_in(
    db: Session,
    first: date,
    last: date,
    vendor_id: int,
    include_optional: bool,
) -> Set[date]:

    q = db.query(HolidayCalendar.HOLIDAY_DATE).filter(
        HolidayCalendar.VENDOR_ID == vendor_id,
        HolidayCalendar.HOLIDAY_DATE >= first,
        HolidayCalendar.HOLIDAY_DATE <= last,
    )

    if not include_optional:
        q = q.filter(HolidayCalendar.IS_OPTIONAL == 0)

    return {row[0] for row in q.all() if row[0] is not None}
