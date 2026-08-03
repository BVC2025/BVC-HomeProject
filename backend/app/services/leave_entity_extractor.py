"""
Leave-agent entity extractor.

Pulls structured data from free-text leave messages:
    - leave_type   (CASUAL / SICK / EARNED / MATERNITY / PATERNITY / COMP_OFF / LOP)
    - start_date   (date)
    - end_date     (date)
    - days         (int, computed when missing)
    - reason       (free-text rationale)
    - half_day     (bool)

Pure rule-based — no external dependency. Handles:
    - Relative phrases: today, tomorrow, day after tomorrow, next monday
    - Absolute dates: 25 June, June 25, 25/06/2026, 2026-06-25
    - Ranges: "from June 25 to June 27", "25th to 27th June"
    - "for N days", "for the next N days"
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional, Dict, List
import re


# -------------------------- types ---------------------------

@dataclass
class LeaveEntities:
    leave_type: Optional[str] = None
    start_date: Optional[date] = None
    end_date:   Optional[date] = None
    days:       Optional[int]  = None
    reason:     Optional[str]  = None
    half_day:   bool = False

    def to_dict(self) -> dict:
        return {
            "leave_type": self.leave_type,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date":   self.end_date.isoformat()   if self.end_date   else None,
            "days":       self.days,
            "reason":     self.reason,
            "half_day":   self.half_day,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "LeaveEntities":
        if not d:
            return cls()
        def parse(s):
            try:    return date.fromisoformat(s) if s else None
            except Exception: return None
        return cls(
            leave_type=d.get("leave_type"),
            start_date=parse(d.get("start_date")),
            end_date=parse(d.get("end_date")),
            days=d.get("days"),
            reason=d.get("reason"),
            half_day=bool(d.get("half_day")),
        )

    def merge(self, other: "LeaveEntities") -> "LeaveEntities":
        """Overlay `other`'s non-None values on top of self."""
        return LeaveEntities(
            leave_type = other.leave_type or self.leave_type,
            start_date = other.start_date or self.start_date,
            end_date   = other.end_date   or self.end_date,
            days       = other.days       or self.days,
            reason     = other.reason     or self.reason,
            half_day   = other.half_day or self.half_day,
        )


# -------------------------- leave type ---------------------------

# Phrase -> canonical LEAVE_TYPE (must match VALID_LEAVE_TYPES in leave.py)
_LEAVE_TYPE_MAP: Dict[str, str] = {
    "casual":     "CASUAL",
    "sick":       "SICK",
    "medical":    "SICK",
    "fever":      "SICK",      # symptom -> sick
    "not well":   "SICK",
    "unwell":     "SICK",
    "earned":     "EARNED",
    "vacation":   "EARNED",
    "annual":     "EARNED",
    "el":         "EARNED",
    "maternity":  "MATERNITY",
    "paternity":  "PATERNITY",
    "comp off":   "COMP_OFF",
    "comp-off":   "COMP_OFF",
    "compensatory": "COMP_OFF",
    "unpaid":     "LOP",
    "lop":        "LOP",
    "loss of pay": "LOP",
}


def _extract_leave_type(text: str) -> Optional[str]:
    """Find the most specific leave type mentioned in the text."""
    t = text.lower()
    # Sort by phrase length desc so multi-word phrases win.
    for phrase in sorted(_LEAVE_TYPE_MAP.keys(), key=len, reverse=True):
        if phrase in t:
            return _LEAVE_TYPE_MAP[phrase]
    # Heuristic: reason-of-leave words imply CASUAL by default.
    if any(w in t for w in [
        "family function", "wedding", "marriage", "funeral",
        "personal", "function",
    ]):
        return "CASUAL"
    return None


# -------------------------- dates ---------------------------

_MONTHS = {
    "jan": 1, "january":   1,
    "feb": 2, "february":  2,
    "mar": 3, "march":     3,
    "apr": 4, "april":     4,
    "may": 5,
    "jun": 6, "june":      6,
    "jul": 7, "july":      7,
    "aug": 8, "august":    8,
    "sep": 9, "sept":      9, "september": 9,
    "oct": 10, "october":  10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

_WEEKDAYS = {
    "monday":    0, "mon": 0,
    "tuesday":   1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday":  3, "thu": 3, "thur": 3, "thurs": 3,
    "friday":    4, "fri": 4,
    "saturday":  5, "sat": 5,
    "sunday":    6, "sun": 6,
}


def _ord_int(s: str) -> Optional[int]:
    """Parse '1st', '22nd', '3rd', '4th', '25' into the integer."""
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?$", s)
    if m:
        return int(m.group(1))
    return None


def _next_weekday(from_day: date, target_idx: int, prefer_future: bool = True) -> date:
    """Return the next date whose weekday == target_idx. If today is
    already that weekday and prefer_future=True, returns +7 days."""
    delta = (target_idx - from_day.weekday()) % 7
    if delta == 0 and prefer_future:
        delta = 7
    return from_day + timedelta(days=delta)


def _extract_dates(text: str, today: date) -> List[date]:
    """Return up to 2 dates: [start, end]. Empty list if none found.

    Tries (in order):
      1. ISO  YYYY-MM-DD
      2. DD/MM/YYYY (Indian default) and DD-MM-YYYY
      3. "<day><ordinal?> <month>" / "<month> <day><ordinal?>"
      4. Relative: today / tomorrow / day after tomorrow
      5. Weekday: this monday / next friday / friday
    """
    t = text.lower()
    found: List[date] = []

    # 1. ISO yyyy-mm-dd
    for m in re.finditer(r"(\d{4})-(\d{1,2})-(\d{1,2})", t):
        try:
            found.append(date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass

    # 2. dd/mm/yyyy or dd-mm-yyyy (Indian)
    for m in re.finditer(
        r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", t
    ):
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100: y += 2000
        try: found.append(date(y, mo, d))
        except ValueError: pass

    # 3. "25 june", "25th june", "june 25", "june 25th", "june 25 2026"
    month_alt = "|".join(_MONTHS.keys())
    # day-first
    for m in re.finditer(
        rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({month_alt})(?:\s+(\d{{4}}))?\b",
        t
    ):
        day = int(m.group(1))
        mo  = _MONTHS[m.group(2)]
        y   = int(m.group(3)) if m.group(3) else today.year
        try:
            d = date(y, mo, day)
            # If "25 june" is in the past, assume next year unless year was explicit
            if not m.group(3) and d < today:
                d = date(y + 1, mo, day)
            found.append(d)
        except ValueError:
            pass
    # month-first
    for m in re.finditer(
        rf"\b({month_alt})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:[,\s]+(\d{{4}}))?\b",
        t
    ):
        mo  = _MONTHS[m.group(1)]
        day = int(m.group(2))
        y   = int(m.group(3)) if m.group(3) else today.year
        try:
            d = date(y, mo, day)
            if not m.group(3) and d < today:
                d = date(y + 1, mo, day)
            found.append(d)
        except ValueError:
            pass

    # 4. Relative day phrases
    if "day after tomorrow" in t:
        found.append(today + timedelta(days=2))
    elif "tomorrow" in t:
        found.append(today + timedelta(days=1))
    if re.search(r"\btoday\b", t):
        found.append(today)

    # 5. Weekday names
    weekday_alt = "|".join(_WEEKDAYS.keys())
    for m in re.finditer(
        rf"\b(next|this|on|coming)?\s*({weekday_alt})\b",
        t
    ):
        target = _WEEKDAYS[m.group(2)]
        qualifier = (m.group(1) or "").strip()
        prefer_future = qualifier != "this"
        d = _next_weekday(today, target, prefer_future=prefer_future)
        if qualifier == "next" and d - today < timedelta(days=7):
            d += timedelta(days=7)
        found.append(d)

    # De-duplicate while preserving order
    seen, deduped = set(), []
    for d in found:
        if d not in seen:
            seen.add(d)
            deduped.append(d)

    # Sort and return at most two
    deduped.sort()
    return deduped[:2]


def _extract_days_count(text: str) -> Optional[int]:
    """Pull explicit day-count phrases: 'for 3 days', 'for the next 5 days'."""
    t = text.lower()
    # "for 3 days" / "for 3 day" / "3 days leave"
    m = re.search(r"\b(?:for\s+)?(\d{1,2})\s+days?\b", t)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 90: return n
    # English numerals
    eng_nums = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    }
    for word, n in eng_nums.items():
        if re.search(rf"\b(?:for\s+)?{word}\s+days?\b", t):
            return n
    return None


def _extract_half_day(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in ["half day", "half-day", "half a day"])


# -------------------------- reason ---------------------------

# When the reason isn't an explicit "for X" phrase, we still want to
# capture the textual rationale. These phrases are kept verbatim so
# the leave record reads naturally to the approver.
_REASON_HINTS = [
    "family function", "wedding", "marriage", "funeral",
    "doctor", "doctor's appointment", "doctor appointment",
    "personal work", "personal reason", "personal",
    "vacation", "out of town", "travel", "fever",
    "not well", "unwell", "medical", "emergency",
]


def _extract_reason(text: str) -> Optional[str]:
    t = text.lower()
    # "for X", "because X", "due to X"
    m = re.search(r"\b(?:for|because of|because|due to|as)\s+([^.,;]+)", t)
    if m:
        reason = m.group(1).strip()
        # Strip trailing date noise — "for a family function on june 25"
        reason = re.split(
            r"\b(on|from|starting|till|until|to)\b", reason
        )[0].strip()
        # Filter out very short / non-meaningful matches
        if len(reason) >= 3 and reason not in {"the", "a", "an"}:
            return reason
    # Hint-based
    for hint in _REASON_HINTS:
        if hint in t:
            return hint
    return None


# -------------------------- public API ---------------------------

class EntityExtractor:
    """Interface for entity extraction — swap with LLM later."""

    def extract(self, text: str, today: Optional[date] = None) -> LeaveEntities:  # pragma: no cover
        raise NotImplementedError


class RuleBasedEntityExtractor(EntityExtractor):
    """Regex / keyword extractor. No external dependencies."""

    def extract(self, text: str, today: Optional[date] = None) -> LeaveEntities:
        if today is None:
            today = date.today()

        if not text:
            return LeaveEntities()

        leave_type = _extract_leave_type(text)
        dates      = _extract_dates(text, today)
        days_count = _extract_days_count(text)
        half_day   = _extract_half_day(text)
        reason     = _extract_reason(text)

        start_date: Optional[date] = None
        end_date:   Optional[date] = None
        days:       Optional[int]  = None

        if len(dates) == 1:
            start_date = dates[0]
            end_date   = dates[0]
        elif len(dates) >= 2:
            start_date, end_date = dates[0], dates[1]

        # If user said "for 3 days" plus a start date but no end, derive end.
        if start_date and days_count and not end_date:
            end_date = start_date + timedelta(days=days_count - 1)
        elif start_date and days_count and end_date == start_date and days_count > 1:
            end_date = start_date + timedelta(days=days_count - 1)

        # If we have both dates compute day count.
        if start_date and end_date:
            days = (end_date - start_date).days + 1
            if half_day and days == 1:
                days = 1  # half-day still counts as 1 row, days_used=0.5 handled in service
        elif days_count:
            days = days_count

        return LeaveEntities(
            leave_type=leave_type,
            start_date=start_date,
            end_date=end_date,
            days=days,
            reason=reason,
            half_day=half_day,
        )


default_extractor: EntityExtractor = RuleBasedEntityExtractor()
