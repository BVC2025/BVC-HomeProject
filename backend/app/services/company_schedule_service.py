"""Company Working Schedule engine — Admin Module 3 extension.

Turns a company's configured WORK_START_TIME / WORK_END_TIME / break
periods into:
  - a validated, always-accurate WORK_HOURS figure. WORK_HOURS is never
    trusted as manual input — recalculate_and_store_work_hours() is the
    only thing allowed to write it, and it is called after every change
    to the schedule or to a break.
  - a real task-scheduling calculator (calculate_task_schedule()) that
    knows how to skip breaks, stop at closing time, and roll unfinished
    work over to the next working day.

This is an additive scheduling layer on top of the existing task
dependency / execution-group / parallel-task logic — it has no
knowledge of TaskTemplateDependency, EXECUTION_GROUP_ID, TASK_SCOPE,
etc. and does not alter any of that behavior.

A company with no schedule configured (WORK_START_TIME or WORK_END_TIME
is NULL) is intentionally left alone by this module — callers fall back
to whatever default they already used before this feature existed (see
project_template.py's DEFAULT_WORK_HOURS usage).
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.models import CompanyMaster, CompanyWorkingBreak


# Existing hardcoded assumption (see project_template.py) — used by
# callers whenever a company has no working schedule configured yet, so
# behavior for those vendors is unchanged by this feature.
DEFAULT_WORK_HOURS = 8.0

_MAX_SCHEDULE_ITERATIONS = 10_000


class ScheduleValidationError(ValueError):
    """Raised for an invalid working-schedule or break configuration."""


# ---- Small helpers -----------------------------------------------------

def _to_minutes(t: dt.time) -> int:
    return t.hour * 60 + t.minute


def breaks_to_dicts(breaks: Iterable[CompanyWorkingBreak]) -> List[dict]:
    """Converts CompanyWorkingBreak ORM rows into the plain dicts used by
    the rest of this module, so the engine has no ORM dependency."""

    return [
        {
            "BREAK_NAME": b.BREAK_NAME,
            "BREAK_START_TIME": b.BREAK_START_TIME,
            "BREAK_END_TIME": b.BREAK_END_TIME,
            "IS_ACTIVE": b.IS_ACTIVE,
        }
        for b in breaks
    ]


# ---- Validation ----------------------------------------------------------

def validate_schedule(work_start: Optional[dt.time], work_end: Optional[dt.time]) -> None:
    """WORK_START_TIME must be earlier than WORK_END_TIME. Same-day
    schedules only — this project has no existing overnight-shift
    support to preserve."""

    if work_start is None or work_end is None:
        return

    if _to_minutes(work_start) >= _to_minutes(work_end):
        raise ScheduleValidationError(
            "Working start time must be earlier than the working end time."
        )


def validate_breaks(
    breaks: Sequence[dict],
    work_start: Optional[dt.time],
    work_end: Optional[dt.time],
) -> None:
    """Every active break must: have a non-empty name, start before it
    ends, sit fully inside the configured working window, and not
    overlap any other active break. Total active break time must not
    consume the entire working window."""

    active = [b for b in breaks if b.get("IS_ACTIVE", True)]

    if not active:
        return

    if work_start is None or work_end is None:
        raise ScheduleValidationError(
            "Working start and end time must be configured before adding break periods."
        )

    ws, we = _to_minutes(work_start), _to_minutes(work_end)
    intervals = []

    for b in active:
        name = (b.get("BREAK_NAME") or "").strip()
        if not name:
            raise ScheduleValidationError("Every break must have a name.")

        start, end = b.get("BREAK_START_TIME"), b.get("BREAK_END_TIME")
        if start is None or end is None:
            raise ScheduleValidationError(f"Break '{name}' is missing a start or end time.")

        s, e = _to_minutes(start), _to_minutes(end)
        if s >= e:
            raise ScheduleValidationError(f"Break '{name}' must start before it ends.")

        if s < ws or e > we:
            raise ScheduleValidationError(
                f"Break '{name}' must fall fully within the working hours "
                f"({work_start.strftime('%H:%M')}–{work_end.strftime('%H:%M')})."
            )

        intervals.append((s, e, name))

    intervals.sort(key=lambda x: x[0])

    total = 0
    prev_end = None
    prev_name = None
    for s, e, name in intervals:
        if prev_end is not None and s < prev_end:
            raise ScheduleValidationError(
                f"Break '{name}' overlaps with break '{prev_name}'."
            )
        total += (e - s)
        prev_end, prev_name = e, name

    if total >= (we - ws):
        raise ScheduleValidationError(
            "Total break duration cannot equal or exceed the working hours window."
        )


# ---- WORK_HOURS computation ----------------------------------------------

def compute_work_hours(
    work_start: Optional[dt.time],
    work_end: Optional[dt.time],
    breaks: Sequence[dict],
) -> Decimal:
    """(end - start) - sum(active break durations), in hours. Returns
    0.00 when no schedule is configured."""

    if work_start is None or work_end is None:
        return Decimal("0.00")

    window_minutes = _to_minutes(work_end) - _to_minutes(work_start)
    if window_minutes <= 0:
        return Decimal("0.00")

    break_minutes = 0
    for b in breaks:
        if not b.get("IS_ACTIVE", True):
            continue
        start, end = b.get("BREAK_START_TIME"), b.get("BREAK_END_TIME")
        if start is None or end is None:
            continue
        break_minutes += max(0, _to_minutes(end) - _to_minutes(start))

    productive_minutes = max(0, window_minutes - break_minutes)
    hours = Decimal(productive_minutes) / Decimal(60)
    return hours.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def recalculate_and_store_work_hours(db: Session, company: CompanyMaster) -> Decimal:
    """Reads the company's current breaks straight from the DB and
    overwrites company.WORK_HOURS. Call this after any change to
    WORK_START_TIME / WORK_END_TIME / working_breaks — a manually
    supplied WORK_HOURS value is never trusted."""

    breaks = breaks_to_dicts(
        db.query(CompanyWorkingBreak)
        .filter(CompanyWorkingBreak.COMPANY_MASTER_ID == company.ID)
        .all()
    )

    hours = compute_work_hours(company.WORK_START_TIME, company.WORK_END_TIME, breaks)
    company.WORK_HOURS = hours
    return hours


# ---- Task scheduling engine -----------------------------------------------

def calculate_task_schedule(
    work_start: dt.time,
    work_end: dt.time,
    breaks: Sequence[dict],
    start_datetime: dt.datetime,
    duration_hours: float,
) -> dict:
    """Computes when a task of `duration_hours` productive hours,
    starting at `start_datetime`, will finish — respecting the company's
    working window and break periods:

      - never scheduled before WORK_START_TIME or after WORK_END_TIME
      - never scheduled inside an active break
      - unfinished work continues at WORK_START_TIME on the next day
      - break time is never counted as task duration

    Returns {start_datetime, end_datetime, end_date, end_time,
    days_spanned, segments} where `segments` is the list of actual
    working intervals ({start, end} datetimes) consumed, in order.
    """

    if work_start is None or work_end is None:
        raise ScheduleValidationError("Company working schedule is not configured.")

    validate_schedule(work_start, work_end)

    duration_hours = float(duration_hours)
    if duration_hours <= 0:
        raise ScheduleValidationError("Duration must be greater than zero.")

    active_breaks = [b for b in breaks if b.get("IS_ACTIVE", True)]
    active_breaks.sort(key=lambda b: _to_minutes(b["BREAK_START_TIME"]))

    ws_min, we_min = _to_minutes(work_start), _to_minutes(work_end)

    def day_start_dt(d: dt.date) -> dt.datetime:
        return dt.datetime.combine(d, work_start)

    def day_end_dt(d: dt.date) -> dt.datetime:
        return dt.datetime.combine(d, work_end)

    def break_intervals_for(d: dt.date):
        return [
            (
                dt.datetime.combine(d, b["BREAK_START_TIME"]),
                dt.datetime.combine(d, b["BREAK_END_TIME"]),
            )
            for b in active_breaks
        ]

    def normalize(instant: dt.datetime) -> dt.datetime:
        """Snaps an instant forward to the nearest valid working
        moment: before opening -> opening time same day; at/after
        closing -> opening time next day; inside a break -> that
        break's end (re-checked, since a break's end could itself
        land at/after closing time)."""

        for _ in range(_MAX_SCHEDULE_ITERATIONS):
            d = instant.date()
            t_min = instant.hour * 60 + instant.minute

            if t_min < ws_min:
                instant = day_start_dt(d)
                continue

            if t_min >= we_min:
                instant = day_start_dt(d + dt.timedelta(days=1))
                continue

            snapped = False
            for bs, be in break_intervals_for(d):
                if bs <= instant < be:
                    instant = be
                    snapped = True
                    break
            if snapped:
                continue

            return instant

        raise ScheduleValidationError("Unable to resolve a valid working start time.")

    current = normalize(start_datetime)
    remaining_minutes = Decimal(str(duration_hours)) * Decimal(60)
    segments: List[dict] = []

    for _ in range(_MAX_SCHEDULE_ITERATIONS):
        if remaining_minutes <= 0:
            break

        current = normalize(current)
        d = current.date()

        next_break_start = None
        next_break_end = None
        for bs, be in break_intervals_for(d):
            if bs >= current:
                next_break_start, next_break_end = bs, be
                break

        segment_end = next_break_start if next_break_start else day_end_dt(d)
        available_minutes = Decimal((segment_end - current).total_seconds()) / Decimal(60)

        if available_minutes <= 0:
            # Only reachable if a break starts exactly at the current
            # instant — normalize() already resolves that case, so this
            # is a defensive no-op guard, not a normal path.
            current = segment_end
            continue

        if remaining_minutes <= available_minutes:
            end_dt = current + dt.timedelta(minutes=float(remaining_minutes))
            segments.append({"start": current, "end": end_dt})
            current = end_dt
            remaining_minutes = Decimal(0)
            break

        segments.append({"start": current, "end": segment_end})
        remaining_minutes -= available_minutes
        current = next_break_end if next_break_start else day_start_dt(d + dt.timedelta(days=1))
    else:
        raise ScheduleValidationError("Task duration is too large to schedule.")

    end_datetime = current

    return {
        "start_datetime": start_datetime,
        "end_datetime": end_datetime,
        "end_date": end_datetime.date(),
        "end_time": end_datetime.time(),
        "days_spanned": len({s["start"].date() for s in segments}) or 1,
        "segments": segments,
    }
