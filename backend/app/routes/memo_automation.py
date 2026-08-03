"""
Memo automation endpoints — admin can trigger the weekly evaluator on
demand and read the last-run summary.

Mounted at /memos/automation.

  POST /memos/automation/run       — kick a run now (optional date range)
  GET  /memos/automation/last-run  — summary of the most recent run
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Setting
from app.auth.auth_bearer import get_current_admin
from app.services.memo_automation import run_weekly_automation, RunSummary


router = APIRouter(prefix="/memos/automation", tags=["Memo Automation"])


LAST_RUN_KEY = "memo_automation.last_run"


class RunRequest(BaseModel):
    period_start: Optional[date] = None
    period_end:   Optional[date] = None


def _serialize(summary: RunSummary) -> dict:
    d = asdict(summary)
    # Convert date/datetime to isoformat for JSON safety
    d["period_start"] = summary.period_start.isoformat()
    d["period_end"]   = summary.period_end.isoformat()
    d["ran_at"]       = summary.ran_at.isoformat()
    return d


def _store_last_run(db: Session, summary: RunSummary) -> None:
    payload = json.dumps(_serialize(summary))
    row = db.query(Setting).filter(Setting.KEY == LAST_RUN_KEY).first()
    if row:
        row.VALUE = payload
        row.UPDATED_AT = datetime.utcnow()
    else:
        db.add(Setting(KEY=LAST_RUN_KEY, VALUE=payload, UPDATED_AT=datetime.utcnow()))
    db.commit()


@router.post("/run")
def run_now(
    body: Optional[RunRequest] = None,
    db: Session = Depends(get_db),
    _admin: dict = Depends(get_current_admin),
):
    """Trigger the memo evaluator immediately. If no dates given, evaluates
    the previous ISO week."""

    start = body.period_start if body else None
    end   = body.period_end   if body else None
    if (start and not end) or (end and not start):
        raise HTTPException(
            status_code=400,
            detail="Provide both period_start and period_end, or neither.",
        )

    summary = run_weekly_automation(db, period_start=start, period_end=end)
    _store_last_run(db, summary)
    return _serialize(summary)


@router.get("/last-run")
def last_run(
    db: Session = Depends(get_db),
    _admin: dict = Depends(get_current_admin),
):
    row = db.query(Setting).filter(Setting.KEY == LAST_RUN_KEY).first()
    if not row or not row.VALUE:
        return {"last_run": None}
    try:
        return {"last_run": json.loads(row.VALUE)}
    except Exception:
        return {"last_run": None}
