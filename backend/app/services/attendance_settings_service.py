"""Attendance office-hours settings.

Office start/end times are stored as configurable values in the
`setting` table (key/value) so admins can change them at any time
without a code deploy. Defaults are 10:00 - 17:30 IST.

Keys used:
  attendance.office_start_time   "HH:MM"   default "10:00"
  attendance.office_end_time     "HH:MM"   default "17:30"
"""

from datetime import time, datetime
from typing import Tuple, Optional

from sqlalchemy.orm import Session

from app.models.models import Setting


KEY_START = "attendance.office_start_time"
KEY_END   = "attendance.office_end_time"

# Phase D — grace windows. Within the grace window we don't auto-create
# a PERMISSION row (employees walking in 5 minutes late shouldn't have
# a PENDING approval queue up against them).
KEY_LATE_GRACE  = "attendance.late_grace_minutes"
KEY_EARLY_GRACE = "attendance.early_exit_grace_minutes"

DEFAULT_START = time(10, 0)    # 10:00 AM
DEFAULT_END   = time(17, 30)   # 5:30 PM
DEFAULT_LATE_GRACE_MIN  = 15
DEFAULT_EARLY_GRACE_MIN = 15


def _parse_hhmm(raw: Optional[str], fallback: time) -> time:
    """Accepts 'HH:MM' or 'HH:MM:SS'; returns fallback on any error."""

    if not raw:

        return fallback

    raw = raw.strip()

    try:

        parts = raw.split(":")

        h = int(parts[0])

        m = int(parts[1]) if len(parts) > 1 else 0

        if 0 <= h <= 23 and 0 <= m <= 59:

            return time(h, m)

    except (ValueError, IndexError):

        pass

    return fallback


def _get_value(db: Session, key: str) -> Optional[str]:

    row = db.query(Setting).filter(Setting.KEY == key).first()

    return row.VALUE if row else None


def _set_value(db: Session, key: str, value: str) -> None:

    row = db.query(Setting).filter(Setting.KEY == key).first()

    if row:

        row.VALUE = value

        row.UPDATED_AT = datetime.utcnow()

    else:

        db.add(Setting(KEY=key, VALUE=value, UPDATED_AT=datetime.utcnow()))


def get_office_hours(db: Session) -> Tuple[time, time]:
    """Returns (start_time, end_time). Falls back to defaults if the
    Setting rows are missing or malformed."""

    start = _parse_hhmm(_get_value(db, KEY_START), DEFAULT_START)

    end   = _parse_hhmm(_get_value(db, KEY_END), DEFAULT_END)

    return start, end


def _strict_hhmm(raw: str) -> time:
    """Parse 'HH:MM' strictly — raises ValueError on bad input."""

    if not raw or not isinstance(raw, str):

        raise ValueError("Time must be a non-empty HH:MM string.")

    parts = raw.strip().split(":")

    if len(parts) < 2:

        raise ValueError(f"Time '{raw}' is not in HH:MM format.")

    h = int(parts[0])

    m = int(parts[1])

    if not (0 <= h <= 23 and 0 <= m <= 59):

        raise ValueError(f"Time '{raw}' is out of range.")

    return time(h, m)


def set_office_hours(
    db: Session,
    start: str,
    end: str
) -> Tuple[time, time]:
    """Persist the new office hours. Validates that start < end and
    both are valid HH:MM strings; raises ValueError otherwise."""

    s = _strict_hhmm(start)

    e = _strict_hhmm(end)

    if s >= e:

        raise ValueError(
            f"Start time ({start}) must be before end time ({end})."
        )

    _set_value(db, KEY_START, s.strftime("%H:%M"))

    _set_value(db, KEY_END,   e.strftime("%H:%M"))

    db.commit()

    return s, e


def is_before_end(now: datetime, end: time) -> bool:
    """True when `now` (a datetime) is before today's end time."""

    return now.time() < end


def is_after_start(now: datetime, start: time) -> bool:
    """True when `now` is at or after today's start time."""

    return now.time() >= start


def get_grace_minutes(db: Session) -> tuple[int, int]:
    """Returns (late_grace_minutes, early_exit_grace_minutes)."""

    def _to_int(raw, fallback):
        try:
            v = int(str(raw).strip())
            return v if v >= 0 else fallback
        except (TypeError, ValueError):
            return fallback

    late  = _to_int(_get_value(db, KEY_LATE_GRACE),  DEFAULT_LATE_GRACE_MIN)
    early = _to_int(_get_value(db, KEY_EARLY_GRACE), DEFAULT_EARLY_GRACE_MIN)

    return late, early


def set_grace_minutes(
    db: Session,
    late_min: int,
    early_min: int
) -> tuple[int, int]:
    """Persist the grace windows. Both must be >= 0."""

    if late_min < 0 or early_min < 0:

        raise ValueError("Grace minutes must be zero or positive.")

    _set_value(db, KEY_LATE_GRACE,  str(int(late_min)))
    _set_value(db, KEY_EARLY_GRACE, str(int(early_min)))

    db.commit()

    return int(late_min), int(early_min)
