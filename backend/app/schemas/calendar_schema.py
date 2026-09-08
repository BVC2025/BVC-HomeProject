"""Pydantic schemas for the Calendar module."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


EVENT_TYPES  = {"MEETING", "CALL", "FOLLOW_UP", "DEMO", "TASK", "OTHER"}
EVENT_STATUS = {"SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"}


class CalendarEventCreate(BaseModel):
    title:            str
    description:      Optional[str] = None
    event_type:       str = "MEETING"
    location:         Optional[str] = None

    start_at:         datetime
    end_at:           datetime
    all_day:          bool = False

    owner_id:         Optional[str] = None      # NULL → server fills with current user
    attendee_ids:     List[str] = Field(default_factory=list)

    lead_id:          Optional[str] = None
    customer_id:      Optional[str] = None

    reminder_minutes: int = 15                  # 0 → no reminder

    @field_validator("event_type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        v = (v or "MEETING").upper()
        if v not in EVENT_TYPES:
            raise ValueError(f"event_type must be one of {sorted(EVENT_TYPES)}")
        return v

    @field_validator("end_at")
    @classmethod
    def _end_after_start(cls, v: datetime, info) -> datetime:
        start = info.data.get("start_at")
        if start and v < start:
            raise ValueError("end_at must be >= start_at")
        return v

    @field_validator("reminder_minutes")
    @classmethod
    def _reminder_range(cls, v: int) -> int:
        if v < 0:
            raise ValueError("reminder_minutes must be >= 0")
        # cap at 30 days — anything longer isn't a reminder, it's a task
        return min(v, 60 * 24 * 30)


class CalendarEventUpdate(BaseModel):
    title:            Optional[str] = None
    description:      Optional[str] = None
    event_type:       Optional[str] = None
    location:         Optional[str] = None

    start_at:         Optional[datetime] = None
    end_at:           Optional[datetime] = None
    all_day:          Optional[bool] = None

    owner_id:         Optional[str] = None
    attendee_ids:     Optional[List[str]] = None

    lead_id:          Optional[str] = None
    customer_id:      Optional[str] = None

    reminder_minutes: Optional[int] = None
    status:           Optional[str] = None
    outcome_notes:    Optional[str] = None

    @field_validator("event_type")
    @classmethod
    def _valid_type(cls, v):
        if v is None:
            return v
        v = v.upper()
        if v not in EVENT_TYPES:
            raise ValueError(f"event_type must be one of {sorted(EVENT_TYPES)}")
        return v

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v):
        if v is None:
            return v
        v = v.upper()
        if v not in EVENT_STATUS:
            raise ValueError(f"status must be one of {sorted(EVENT_STATUS)}")
        return v


class CalendarEventComplete(BaseModel):
    outcome_notes: Optional[str] = None


class CalendarEventOut(BaseModel):
    id:               str
    vendor_id:        int
    title:            str
    description:      Optional[str] = None
    event_type:       str
    location:         Optional[str] = None

    start_at:         datetime
    end_at:           datetime
    all_day:          bool

    status:           str
    outcome_notes:    Optional[str] = None

    owner_id:         Optional[str] = None
    owner_name:       Optional[str] = None
    created_by_id:    Optional[str] = None
    attendee_ids:     List[str] = Field(default_factory=list)

    lead_id:          Optional[str] = None
    lead_name:        Optional[str] = None
    customer_id:      Optional[str] = None      # customer.ID is VARCHAR(36) UUID
    customer_name:    Optional[str] = None

    reminder_minutes: int
    reminder_sent:    bool

    created_at:       datetime
    updated_at:       datetime
