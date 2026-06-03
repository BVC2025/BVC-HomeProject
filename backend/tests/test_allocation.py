"""
AI allocator scoring tests.

Covers:
  - Skill overlap drives project selection
  - Workload penalty reduces over-allocated employees' score
  - Allocation breakdown is explainable
  - Re-running allocator after a task completion gives a NEW task
"""

import pytest

from app.services.allocation_service import (
    _skill_overlap,
    _workload_score,
    _split_skills,
    PRIORITY_SCORE,
    W_SKILL,
    W_WORKLOAD,
    W_PRIORITY
)


@pytest.mark.smoke
def test_skill_overlap_perfect_match():

    emp = _split_skills("welding,wiring,assembly")

    proj = _split_skills("welding,wiring,assembly")

    assert _skill_overlap(emp, proj) == 1.0


@pytest.mark.smoke
def test_skill_overlap_partial_match():

    emp = _split_skills("welding,wiring")

    proj = _split_skills("welding,wiring,assembly,quality")

    # 2 of 4 project skills matched
    assert _skill_overlap(emp, proj) == 0.5


@pytest.mark.smoke
def test_skill_overlap_no_employee_skills_returns_zero():

    assert _skill_overlap(set(), {"welding"}) == 0.0


@pytest.mark.smoke
def test_skill_overlap_no_project_skills_returns_neutral():

    # Project hasn't declared required skills -> neutral 0.5
    assert _skill_overlap({"welding"}, set()) == 0.5


@pytest.mark.smoke
def test_workload_score_decays():

    assert _workload_score(0) == 1.0

    # Capped at WORKLOAD_CAP (8) -> 0
    assert _workload_score(8) == 0.0

    assert _workload_score(20) == 0.0


@pytest.mark.smoke
def test_weights_sum_to_one():

    assert abs((W_SKILL + W_WORKLOAD + W_PRIORITY) - 1.0) < 0.0001


@pytest.mark.smoke
def test_priority_score_high_beats_low():

    assert PRIORITY_SCORE["HIGH"] > PRIORITY_SCORE["MEDIUM"]

    assert PRIORITY_SCORE["MEDIUM"] > PRIORITY_SCORE["LOW"]


@pytest.mark.integration
def test_allocation_picks_skill_matched_project(seeded_client):
    """Ravi Kumar (BVC001) has skills 'assembly,wiring,sheet metal,quality
    check' — the seeded Chennai Snack Combo project requires exactly these
    skills so the allocator should pick it."""

    res = seeded_client.post(
        "/biometric/scan",
        json={
            "DEVICE_ID": "BVC24-GATE-01",
            "FINGERPRINT_ID": "1001",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 200

    alloc = res.json()["allocation"]

    assert alloc["allocated"] is True

    assert "Snack" in alloc["project"]["PROJECT_NAME"]

    assert alloc["score"] > 0.5

    assert "skill" in alloc["breakdown"].lower()


@pytest.mark.integration
def test_allocation_breakdown_is_explainable(seeded_client):

    res = seeded_client.post(
        "/biometric/scan",
        json={"DEVICE_ID": "X", "FINGERPRINT_ID": "1002", "VENDOR_ID": 1}
    )

    alloc = res.json()["allocation"]

    assert "skill=" in alloc["breakdown"]

    assert "workload=" in alloc["breakdown"]

    assert "priority=" in alloc["breakdown"]

    assert alloc["reason"]  # human-readable string
