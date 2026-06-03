"""
Quality Management endpoint tests.

Covers:
  - Checklist templates seeded per model
  - Inspection creation pre-populates result rows
  - Marking results updates PASS/FAIL counts
  - Finalise with FAIL opens NCRs
  - NCR status transitions
"""

import pytest


# ---- Checklists ------------------------------------------------

@pytest.mark.smoke
def test_seeded_checklists_for_each_model(seeded_client):

    models = seeded_client.get("/production/models").json()

    for m in models:

        res = seeded_client.get(f"/quality/checklist/{m['ID']}")

        assert res.status_code == 200

        items = res.json()

        # Every seeded model has >= 7 inspection points
        assert len(items) >= 7

        assert all(
            i["SEVERITY"] in ("CRITICAL", "MAJOR", "MINOR")
            for i in items
        )


@pytest.mark.integration
def test_add_checklist_item(seeded_client):

    models = seeded_client.get("/production/models").json()

    res = seeded_client.post(
        "/quality/checklist-items",
        json={
            "PRODUCT_MODEL_ID": models[0]["ID"],
            "CHECK_POINT": "Custom test check",
            "DESCRIPTION": "Verifies a test condition",
            "SEVERITY": "MAJOR",
            "SEQUENCE": 99
        }
    )

    assert res.status_code == 200

    assert res.json()["item"]["CHECK_POINT"] == "Custom test check"


# ---- Inspection lifecycle --------------------------------------

@pytest.mark.integration
def test_create_inspection_prepopulates_results(seeded_client):

    wos = seeded_client.get("/production/work-orders?status=IN_PROGRESS").json()

    wo = wos[0]

    res = seeded_client.post(
        "/quality/inspections",
        json={
            "WORK_ORDER_ID": wo["ID"],
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 200

    data = res.json()

    assert data["checklist_items_count"] >= 7

    insp_id = data["inspection_id"]

    detail = seeded_client.get(f"/quality/inspections/{insp_id}").json()

    assert len(detail["results"]) == data["checklist_items_count"]

    assert all(r["RESULT"] == "PENDING" for r in detail["results"])


@pytest.mark.integration
def test_mark_result_updates_inspection_counts(seeded_client):

    wos = seeded_client.get("/production/work-orders?status=IN_PROGRESS").json()

    insp = seeded_client.post(
        "/quality/inspections",
        json={"WORK_ORDER_ID": wos[0]["ID"], "VENDOR_ID": 1}
    ).json()

    insp_id = insp["inspection_id"]

    detail = seeded_client.get(f"/quality/inspections/{insp_id}").json()

    # Mark first 3 as PASS, 1 as FAIL
    for r in detail["results"][:3]:

        seeded_client.patch(
            f"/quality/results/{r['ID']}",
            json={"RESULT": "PASS"}
        )

    seeded_client.patch(
        f"/quality/results/{detail['results'][3]['ID']}",
        json={"RESULT": "FAIL", "NOTES": "Test failure"}
    )

    refreshed = seeded_client.get(f"/quality/inspections/{insp_id}").json()

    assert refreshed["inspection"]["PASS_COUNT"] == 3

    assert refreshed["inspection"]["FAIL_COUNT"] == 1


@pytest.mark.integration
def test_finalise_with_fail_opens_ncr(seeded_client):

    wos = seeded_client.get("/production/work-orders?status=IN_PROGRESS").json()

    insp = seeded_client.post(
        "/quality/inspections",
        json={"WORK_ORDER_ID": wos[0]["ID"], "VENDOR_ID": 1}
    ).json()

    detail = seeded_client.get(f"/quality/inspections/{insp['inspection_id']}").json()

    # Mark all PASS except one FAIL
    for r in detail["results"][:-1]:

        seeded_client.patch(
            f"/quality/results/{r['ID']}",
            json={"RESULT": "PASS"}
        )

    seeded_client.patch(
        f"/quality/results/{detail['results'][-1]['ID']}",
        json={"RESULT": "FAIL", "NOTES": "needs rework"}
    )

    final = seeded_client.post(
        f"/quality/inspections/{insp['inspection_id']}/finalise",
        json={}
    ).json()

    assert final["status"] == "FAIL"

    assert len(final["ncrs_opened"]) == 1

    ncrs = seeded_client.get("/quality/ncrs?status=OPEN").json()

    assert len(ncrs) >= 1


@pytest.mark.integration
def test_finalise_all_pass_returns_pass(seeded_client):

    wos = seeded_client.get("/production/work-orders?status=IN_PROGRESS").json()

    insp = seeded_client.post(
        "/quality/inspections",
        json={"WORK_ORDER_ID": wos[0]["ID"], "VENDOR_ID": 1}
    ).json()

    detail = seeded_client.get(f"/quality/inspections/{insp['inspection_id']}").json()

    for r in detail["results"]:

        seeded_client.patch(
            f"/quality/results/{r['ID']}",
            json={"RESULT": "PASS"}
        )

    final = seeded_client.post(
        f"/quality/inspections/{insp['inspection_id']}/finalise",
        json={}
    ).json()

    assert final["status"] == "PASS"

    assert len(final["ncrs_opened"]) == 0


# ---- NCR --------------------------------------------------------

@pytest.mark.smoke
def test_ncr_status_transition(seeded_client):

    # Force a fail+finalise to create an NCR first
    wos = seeded_client.get("/production/work-orders?status=IN_PROGRESS").json()

    insp = seeded_client.post(
        "/quality/inspections",
        json={"WORK_ORDER_ID": wos[0]["ID"], "VENDOR_ID": 1}
    ).json()

    detail = seeded_client.get(f"/quality/inspections/{insp['inspection_id']}").json()

    seeded_client.patch(
        f"/quality/results/{detail['results'][0]['ID']}",
        json={"RESULT": "FAIL", "NOTES": "fail"}
    )

    seeded_client.post(
        f"/quality/inspections/{insp['inspection_id']}/finalise",
        json={}
    )

    ncrs = seeded_client.get("/quality/ncrs").json()

    assert len(ncrs) >= 1

    ncr = ncrs[0]

    res = seeded_client.patch(
        f"/quality/ncrs/{ncr['ID']}",
        json={"STATUS": "CLOSED"}
    )

    assert res.status_code == 200

    assert res.json()["ncr"]["STATUS"] == "CLOSED"

    assert res.json()["ncr"]["CLOSED_AT"] is not None


# ---- Dashboard --------------------------------------------------

@pytest.mark.smoke
def test_quality_dashboard(seeded_client):

    res = seeded_client.get("/quality/dashboard?vendor_id=1")

    assert res.status_code == 200

    data = res.json()

    assert "total_inspections" in data

    assert "pass_rate_pct" in data

    assert "open_ncrs" in data
