"""
MD Performance Review endpoint tests.

Covers:
  - Increment band table is exposed
  - /performance/summary returns the leaderboard
  - /performance/employee/{id} returns drill-down with per-task breakdown
  - Score = 0 when no completed tasks
  - Score increases when tasks are completed on time
"""

from datetime import date, datetime, time, timedelta

import pytest


@pytest.mark.smoke
def test_bands_endpoint(seeded_client):

    res = seeded_client.get("/performance/bands")

    assert res.status_code == 200

    bands = res.json()

    assert len(bands) >= 4

    # Bands must be ordered descending by min_score
    scores = [b["min_score"] for b in bands]

    assert scores == sorted(scores, reverse=True)

    labels = {b["label"] for b in bands}

    assert "Outstanding" in labels


@pytest.mark.smoke
def test_summary_returns_employees(seeded_client):

    res = seeded_client.get("/performance/summary?vendor_id=1")

    assert res.status_code == 200

    data = res.json()

    assert "employees" in data

    assert data["summary"]["total_employees"] == 6


@pytest.mark.integration
def test_zero_completed_tasks_yields_zero_score(seeded_client):

    summary = seeded_client.get("/performance/summary?vendor_id=1").json()

    # No tasks completed yet by anyone -> everyone scores 0
    for row in summary["employees"]:

        assert row["performance_score"] == 0

        assert row["suggested_increment_pct"] == 0

        assert row["band"] == "No data"


@pytest.mark.integration
def test_employee_drilldown(seeded_client):

    emps_res = seeded_client.get("/performance/summary").json()

    assert emps_res["employees"], "Need at least one employee"

    emp = emps_res["employees"][0]

    res = seeded_client.get(f"/performance/employee/{emp['EMPLOYEE_ID']}")

    assert res.status_code == 200

    data = res.json()

    assert data["employee"]["NAME"] == emp["NAME"]

    assert "score" in data

    assert "tasks" in data


@pytest.mark.integration
def test_completed_task_lifts_score(seeded_client, db_session):
    """End-to-end: bookkeep a completed task and verify score > 0."""

    from app.models.models import (
        Employee, TaskAssignment, Project
    )

    emp = (
        db_session.query(Employee)
        .filter(Employee.EMPLOYEE_CODE == "BVC001")
        .first()
    )

    proj = db_session.query(Project).first()

    now = datetime.utcnow()

    shift_end_today = datetime.combine(date.today(), time(18, 0))

    # End 2 hours before shift end -> on-time + early
    completed_at = shift_end_today - timedelta(hours=2)

    task = TaskAssignment(
        EMPLOYEE_ID=emp.ID,
        PROJECT_ID=proj.ID,
        TASK_NAME="Completed task",
        TASK_DETAILS="Used for score test",
        ASSIGNED_DATE=date.today(),
        DUE_DATE=date.today(),
        TASK_STATUS="DONE",
        APPROVAL_STATUS="APPROVED",
        START_TIME=now - timedelta(hours=3),
        END_TIME=completed_at,
        UPDATED_AT=now
    )

    db_session.add(task)

    db_session.commit()

    res = seeded_client.get(
        f"/performance/employee/{emp.ID}"
    ).json()

    assert res["score"]["total_tasks_completed"] >= 1

    assert res["score"]["performance_score"] > 0

    assert res["score"]["on_time_count"] >= 1
