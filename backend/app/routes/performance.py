"""
MD Performance Review endpoints.

Read-only views over completed-task + attendance data, scored by
performance_service. The MD's UI calls these to build the
"who deserves an increment this cycle" report.
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import Employee, Department, Vendor

from app.services.performance_service import (
    score_employee,
    score_all_employees,
    task_breakdown_for_employee,
    INCREMENT_BANDS
)


router = APIRouter(prefix="/performance", tags=["MD Performance"])


def _resolve_vendor_id(db: Session, requested: Optional[int]) -> int:
    """Same fallback as production routes — if the requested vendor
    has no employees, default to BVC24 by name."""

    if requested:

        has_data = (
            db.query(Employee)
            .filter(Employee.VENDOR_ID == requested)
            .first()
            is not None
        )

        if has_data:

            return requested

    bvc = db.query(Vendor).filter(
        Vendor.VENDOR_NAME == "Bharath Vending Corporation"
    ).first()

    if bvc:

        return bvc.ID

    any_v = db.query(Vendor).first()

    return any_v.ID if any_v else (requested or 1)


def _resolve_range(
    date_from: Optional[date],
    date_to: Optional[date]
) -> tuple[date, date]:

    today = date.today()

    if not date_to:

        date_to = today

    if not date_from:

        date_from = date_to - timedelta(days=29)

    if date_from > date_to:

        raise HTTPException(
            status_code=400,
            detail="date_from must be on or before date_to"
        )

    return date_from, date_to


@router.get("/bands")
def increment_bands():
    """The HR-tunable band table — surfaced so the UI can render
    the legend without hard-coding the same constants."""

    return [
        {
            "min_score": threshold,
            "increment_pct": pct,
            "label": label
        }
        for threshold, pct, label in INCREMENT_BANDS
    ]


@router.get("/summary")
def md_summary(
    vendor_id: int = 1,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    department_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """
    Org-wide leaderboard for the MD: every active employee's
    performance score + suggested increment over the chosen
    range. Defaults to the trailing 30 days.
    """

    date_from, date_to = _resolve_range(date_from, date_to)

    vendor_id = _resolve_vendor_id(db, vendor_id)

    rows = score_all_employees(
        db,
        vendor_id=vendor_id,
        date_from=date_from,
        date_to=date_to,
        department_id=department_id
    )

    # Attach department names for the UI
    dept_map = {
        d.ID: d.NAME for d in db.query(Department).all()
    }

    for r in rows:

        r["DEPARTMENT_NAME"] = dept_map.get(
            r.get("DEPARTMENT_ID")
        )

    # Org-level aggregates
    total_employees = len(rows)

    promotable = sum(
        1 for r in rows if r["suggested_increment_pct"] >= 8.0
    )

    needs_review = sum(
        1 for r in rows if r["band"] == "Needs review"
    )

    avg_score = (
        round(
            sum(r["performance_score"] for r in rows) / total_employees,
            1
        )
        if total_employees else 0
    )

    return {
        "period": {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "days": (date_to - date_from).days + 1
        },
        "summary": {
            "total_employees": total_employees,
            "avg_performance_score": avg_score,
            "promotable_count": promotable,
            "needs_review_count": needs_review
        },
        "employees": rows
    }


@router.get("/employee/{employee_id}")
def employee_detail(
    employee_id: str,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Per-employee drill-down — score + the underlying per-task
    breakdown that drove it. Used by the MD when reviewing an
    individual recommendation.
    """

    date_from, date_to = _resolve_range(date_from, date_to)

    employee = db.query(Employee).filter(
        Employee.ID == employee_id
    ).first()

    if not employee:

        raise HTTPException(
            status_code=404,
            detail="Employee not found"
        )

    aggregate = score_employee(db, employee, date_from, date_to)

    tasks = task_breakdown_for_employee(
        db, employee, date_from, date_to
    )

    return {
        "employee": {
            "ID": employee.ID,
            "EMPLOYEE_CODE": employee.EMPLOYEE_CODE,
            "NAME": employee.NAME,
            "EMAIL": employee.EMAIL,
            "DEPARTMENT_ID": employee.DEPARTMENT_ID,
            "SHIFT_START": (
                employee.SHIFT_START.isoformat()
                if employee.SHIFT_START else None
            ),
            "SHIFT_END": (
                employee.SHIFT_END.isoformat()
                if employee.SHIFT_END else None
            ),
            "SKILLS": employee.SKILLS
        },
        "score": aggregate,
        "tasks": tasks
    }


# ====================================================================
# ⭐ STAR PERFORMANCE RATING (new BVC24 module)
# ====================================================================
# Distinct from the older /performance/summary above. The star
# system computes one PerformanceScore row per employee per month
# with 4 weighted dimensions: attendance, task completion,
# productivity, consistency. MD uses this for promotion / increment
# / reward decisions.

from datetime import datetime as _dt
from pydantic import BaseModel as _BaseModel

from app.models.models import PerformanceScore
from app.services.star_performance_service import (
    compute_performance_for_all,
    compute_performance_for_employee
)


class StarsComputeRequest(_BaseModel):

    VENDOR_ID: int = 1
    YEAR: int
    MONTH: int


def _serialize_score(score: PerformanceScore, employee=None) -> dict:

    return {
        "ID": score.ID,
        "EMPLOYEE_ID": score.EMPLOYEE_ID,
        "EMPLOYEE_NAME": employee.NAME if employee else None,
        "EMPLOYEE_CODE": employee.EMPLOYEE_CODE if employee else None,
        "DEPARTMENT_ID": employee.DEPARTMENT_ID if employee else None,
        "PHOTO_URL": (
            getattr(employee, "PHOTO_URL", None) if employee else None
        ),
        "PAY_YEAR": score.PAY_YEAR,
        "PAY_MONTH": score.PAY_MONTH,
        "PERIOD_LABEL": f"{score.PAY_YEAR}-{score.PAY_MONTH:02d}",
        "WORKING_DAYS": score.WORKING_DAYS,
        "DAYS_PRESENT": score.DAYS_PRESENT,
        "HALF_DAYS": score.HALF_DAYS,
        "TASKS_ASSIGNED": score.TASKS_ASSIGNED,
        "TASKS_COMPLETED": score.TASKS_COMPLETED,
        "TASKS_ON_TIME": score.TASKS_ON_TIME,
        "ESTIMATED_HOURS": score.ESTIMATED_HOURS,
        "ACTUAL_HOURS": score.ACTUAL_HOURS,
        "ATTENDANCE_STARS": score.ATTENDANCE_STARS,
        "TASK_STARS": score.TASK_STARS,
        "PRODUCTIVITY_STARS": score.PRODUCTIVITY_STARS,
        "CONSISTENCY_STARS": score.CONSISTENCY_STARS,
        "OVERALL_STARS": score.OVERALL_STARS,
        "RECOMMENDED_FOR_PROMOTION": bool(score.RECOMMENDED_FOR_PROMOTION),
        "RECOMMENDED_FOR_INCREMENT": bool(score.RECOMMENDED_FOR_INCREMENT),
        "REWARDED": bool(score.REWARDED),
        "MD_REMARKS": score.MD_REMARKS,
        "CREATED_AT": (
            score.CREATED_AT.isoformat() if score.CREATED_AT else None
        ),
        "UPDATED_AT": (
            score.UPDATED_AT.isoformat() if score.UPDATED_AT else None
        )
    }


@router.post("/stars/compute")
def compute_stars(
    data: StarsComputeRequest,
    db: Session = Depends(get_db)
):
    """Compute (or refresh) star scores for every active non-admin
    employee for the given month. Idempotent — re-running overwrites
    the previous scores so the MD always sees current data."""

    vendor_id = _resolve_vendor_id(db, data.VENDOR_ID)

    if not (1 <= data.MONTH <= 12):

        raise HTTPException(
            status_code=400,
            detail="MONTH must be 1..12"
        )

    summary = compute_performance_for_all(
        db, vendor_id, data.YEAR, data.MONTH
    )

    return {
        "message": (
            f"Star scores computed for {data.YEAR}-{data.MONTH:02d}: "
            f"{summary['scored']} employee(s) scored."
        ),
        **summary
    }


@router.get("/stars")
def list_stars(
    vendor_id: int = 1,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """List star scores for a given period. If year/month not
    given, returns the latest month available."""

    vendor_id = _resolve_vendor_id(db, vendor_id)

    if year is None or month is None:

        latest = (
            db.query(PerformanceScore)
            .order_by(
                PerformanceScore.PAY_YEAR.desc(),
                PerformanceScore.PAY_MONTH.desc()
            )
            .first()
        )

        if not latest:

            return {
                "year": None,
                "month": None,
                "scores": []
            }

        year, month = latest.PAY_YEAR, latest.PAY_MONTH

    rows = (
        db.query(PerformanceScore, Employee)
        .join(Employee, PerformanceScore.EMPLOYEE_ID == Employee.ID)
        .filter(
            PerformanceScore.PAY_YEAR == year,
            PerformanceScore.PAY_MONTH == month,
            Employee.VENDOR_ID == vendor_id
        )
        .order_by(PerformanceScore.OVERALL_STARS.desc())
        .all()
    )

    return {
        "year": year,
        "month": month,
        "scores": [_serialize_score(s, e) for s, e in rows]
    }


@router.get("/stars/top")
def top_performers(
    vendor_id: int = 1,
    limit: int = 5,
    db: Session = Depends(get_db)
):
    """Top N performers for the latest computed period. Used by
    the dashboard tile."""

    vendor_id = _resolve_vendor_id(db, vendor_id)

    latest = (
        db.query(PerformanceScore)
        .order_by(
            PerformanceScore.PAY_YEAR.desc(),
            PerformanceScore.PAY_MONTH.desc()
        )
        .first()
    )

    if not latest:

        return {"period": None, "top": []}

    rows = (
        db.query(PerformanceScore, Employee)
        .join(Employee, PerformanceScore.EMPLOYEE_ID == Employee.ID)
        .filter(
            PerformanceScore.PAY_YEAR == latest.PAY_YEAR,
            PerformanceScore.PAY_MONTH == latest.PAY_MONTH,
            Employee.VENDOR_ID == vendor_id
        )
        .order_by(PerformanceScore.OVERALL_STARS.desc())
        .limit(limit)
        .all()
    )

    return {
        "period": f"{latest.PAY_YEAR}-{latest.PAY_MONTH:02d}",
        "top": [_serialize_score(s, e) for s, e in rows]
    }


@router.get("/stars/employee/{employee_id}/history")
def employee_history(
    employee_id: str,
    db: Session = Depends(get_db)
):
    """All historical star scores for one employee, oldest first.
    Used to draw the trend graph on their profile."""

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    rows = (
        db.query(PerformanceScore)
        .filter(PerformanceScore.EMPLOYEE_ID == employee_id)
        .order_by(
            PerformanceScore.PAY_YEAR.asc(),
            PerformanceScore.PAY_MONTH.asc()
        )
        .all()
    )

    return {
        "employee_id": emp.ID,
        "employee_name": emp.NAME,
        "employee_code": emp.EMPLOYEE_CODE,
        "history": [_serialize_score(s, emp) for s in rows]
    }


class StarsActionRequest(_BaseModel):

    PROMOTION: Optional[bool] = None
    INCREMENT: Optional[bool] = None
    REWARDED: Optional[bool] = None
    REMARKS: Optional[str] = None


@router.patch("/stars/{score_id}/action")
def record_md_action(
    score_id: int,
    data: StarsActionRequest,
    db: Session = Depends(get_db)
):
    """MD records a decision against an employee's monthly score:
    recommend for promotion, increment, mark rewarded, or attach
    a free-text remark."""

    score = db.query(PerformanceScore).filter(
        PerformanceScore.ID == score_id
    ).first()

    if not score:

        raise HTTPException(status_code=404, detail="Score not found")

    if data.PROMOTION is not None:

        score.RECOMMENDED_FOR_PROMOTION = 1 if data.PROMOTION else 0

    if data.INCREMENT is not None:

        score.RECOMMENDED_FOR_INCREMENT = 1 if data.INCREMENT else 0

    if data.REWARDED is not None:

        score.REWARDED = 1 if data.REWARDED else 0

    if data.REMARKS is not None:

        score.MD_REMARKS = data.REMARKS

    db.commit()

    db.refresh(score)

    return {
        "message": "MD action recorded.",
        "score_id": score.ID
    }
