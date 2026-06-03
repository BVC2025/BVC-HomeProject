"""
Biometric gate-scan endpoint tests.

Covers:
  - Seed populates fingerprints 1001-1006
  - First scan check-in returns CHECKED_IN + an allocation
  - Unknown fingerprint returns 404
  - Re-scan within debounce window returns TASK_IN_PROGRESS
  - /biometric/events feed records every scan
"""

import pytest


@pytest.mark.smoke
def test_seed_creates_demo_data(client):

    res = client.post("/demo/seed-bvc24")

    assert res.status_code == 200

    data = res.json()

    assert data["product_models"] == 5

    assert len(data["demo_fingerprint_ids"]) == 6

    assert data["suppliers"] == 7


@pytest.mark.smoke
def test_scan_with_unknown_fingerprint_returns_404(seeded_client):

    res = seeded_client.post(
        "/biometric/scan",
        json={
            "DEVICE_ID": "BVC24-GATE-01",
            "FINGERPRINT_ID": "9999",
            "VERIFY_MODE": "FP",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 404

    assert "9999" in res.json()["detail"]


@pytest.mark.integration
def test_first_scan_checks_in_and_allocates(seeded_client):

    res = seeded_client.post(
        "/biometric/scan",
        json={
            "DEVICE_ID": "BVC24-GATE-01",
            "FINGERPRINT_ID": "1001",
            "VERIFY_MODE": "FP",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 200

    data = res.json()

    assert data["action"] == "CHECKED_IN"

    assert "Ravi" in data["message"]

    assert data["employee"]["EMPLOYEE_CODE"] == "BVC001"

    assert data["attendance"]["CHECK_IN"] is not None

    assert data["allocation"]["allocated"] is True

    assert data["allocation"]["project"] is not None

    assert data["allocation"]["task"] is not None


@pytest.mark.integration
def test_rescan_within_debounce_returns_task_in_progress(seeded_client):
    """Second scan within 5 minutes shouldn't auto-complete the task."""

    seeded_client.post(
        "/biometric/scan",
        json={
            "DEVICE_ID": "BVC24-GATE-01",
            "FINGERPRINT_ID": "1002",
            "VENDOR_ID": 1
        }
    )

    res = seeded_client.post(
        "/biometric/scan",
        json={
            "DEVICE_ID": "BVC24-GATE-01",
            "FINGERPRINT_ID": "1002",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 200

    assert res.json()["action"] == "TASK_IN_PROGRESS"


@pytest.mark.smoke
def test_events_feed_lists_scans(seeded_client):

    seeded_client.post(
        "/biometric/scan",
        json={
            "DEVICE_ID": "BVC24-GATE-01",
            "FINGERPRINT_ID": "1003",
            "VENDOR_ID": 1
        }
    )

    res = seeded_client.get("/biometric/events?limit=10")

    assert res.status_code == 200

    events = res.json()

    assert len(events) >= 1

    success_events = [e for e in events if e["RESULT"] == "SUCCESS"]

    assert any(e["FINGERPRINT_ID"] == "1003" for e in success_events)


@pytest.mark.integration
def test_inactive_employee_blocked(seeded_client, db_session):
    """An employee with STATUS != ACTIVE should be rejected with 403."""

    from app.models.models import Employee

    emp = db_session.query(Employee).filter(
        Employee.EMPLOYEE_CODE == "BVC005"
    ).first()

    assert emp is not None

    emp.STATUS = "SUSPENDED"

    db_session.commit()

    res = seeded_client.post(
        "/biometric/scan",
        json={
            "DEVICE_ID": "BVC24-GATE-01",
            "FINGERPRINT_ID": "1005",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 403

    assert "not" in res.json()["detail"].lower()
