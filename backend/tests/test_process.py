"""
Process Stage + WO Gantt tests.

Covers:
  - 10 common stages seeded per machine model
  - Stage progress rows spawned when WO is created
  - PATCH stage progress: PENDING -> IN_PROGRESS -> DONE / FAILED
  - /process/wo/{id}/gantt returns timeline data
  - BOM item classification: PURCHASE vs PROCESS
"""

import pytest


# ---- Stage templates -------------------------------------------

@pytest.mark.smoke
def test_seeded_stages_per_model(seeded_client):

    models = seeded_client.get("/production/models").json()

    for m in models:

        res = seeded_client.get(f"/process/stages/{m['ID']}")

        assert res.status_code == 200

        stages = res.json()

        assert len(stages) == 10

        # Sequence must be 1..10
        seqs = sorted(s["SEQUENCE"] for s in stages)

        assert seqs == list(range(1, 11))


# ---- WO Stage progress -----------------------------------------

@pytest.mark.integration
def test_wo_stages_endpoint_returns_progress(seeded_client):

    wos = seeded_client.get("/production/work-orders").json()

    wo = wos[0]

    res = seeded_client.get(f"/process/wo/{wo['ID']}/stages")

    assert res.status_code == 200

    stages = res.json()

    assert len(stages) == 10

    assert all(s["STAGE_NAME"] for s in stages)


@pytest.mark.integration
def test_mark_stage_in_progress_then_done(seeded_client):

    wos = seeded_client.get("/production/work-orders?status=PLANNED").json()

    wo = wos[0]

    stages = seeded_client.get(f"/process/wo/{wo['ID']}/stages").json()

    first = stages[0]

    start_res = seeded_client.patch(
        f"/process/wo/{wo['ID']}/stages/{first['STAGE_ID']}",
        json={"STATUS": "IN_PROGRESS"}
    )

    assert start_res.status_code == 200

    done_res = seeded_client.patch(
        f"/process/wo/{wo['ID']}/stages/{first['STAGE_ID']}",
        json={"STATUS": "DONE"}
    )

    assert done_res.status_code == 200

    refreshed = seeded_client.get(
        f"/process/wo/{wo['ID']}/stages"
    ).json()

    target = next(s for s in refreshed if s["STAGE_ID"] == first["STAGE_ID"])

    assert target["STATUS"] == "DONE"

    assert target["STARTED_AT"] is not None

    assert target["COMPLETED_AT"] is not None


@pytest.mark.integration
def test_mark_stage_failed_with_notes(seeded_client):

    wos = seeded_client.get("/production/work-orders?status=PLANNED").json()

    wo = wos[0]

    stages = seeded_client.get(f"/process/wo/{wo['ID']}/stages").json()

    target = stages[2]

    res = seeded_client.patch(
        f"/process/wo/{wo['ID']}/stages/{target['STAGE_ID']}",
        json={
            "STATUS": "FAILED",
            "NOTES": "Sheet thickness wrong - needs recut"
        }
    )

    assert res.status_code == 200

    refreshed = seeded_client.get(
        f"/process/wo/{wo['ID']}/stages"
    ).json()

    failed = next(s for s in refreshed if s["STAGE_ID"] == target["STAGE_ID"])

    assert failed["STATUS"] == "FAILED"

    assert "Sheet thickness" in (failed["NOTES"] or "")


@pytest.mark.smoke
def test_invalid_status_returns_400(seeded_client):

    wos = seeded_client.get("/production/work-orders").json()

    stages = seeded_client.get(f"/process/wo/{wos[0]['ID']}/stages").json()

    res = seeded_client.patch(
        f"/process/wo/{wos[0]['ID']}/stages/{stages[0]['STAGE_ID']}",
        json={"STATUS": "INVALID_STATUS"}
    )

    assert res.status_code == 400


# ---- Gantt endpoint --------------------------------------------

@pytest.mark.integration
def test_gantt_endpoint_returns_bars(seeded_client):

    wos = seeded_client.get("/production/work-orders").json()

    wo = wos[0]

    res = seeded_client.get(f"/process/wo/{wo['ID']}/gantt")

    assert res.status_code == 200

    data = res.json()

    assert len(data["stages"]) == 10

    assert data["total_planned_hours"] > 0

    # Each bar must have planned + status
    for bar in data["stages"]:

        assert bar["planned_start"]

        assert bar["planned_end"]

        assert bar["status"] in (
            "PENDING", "IN_PROGRESS", "DONE", "FAILED", "SKIPPED"
        )


@pytest.mark.integration
def test_gantt_progress_count_updates_after_done(seeded_client):

    wos = seeded_client.get("/production/work-orders?status=PLANNED").json()

    wo = wos[0]

    stages = seeded_client.get(f"/process/wo/{wo['ID']}/stages").json()

    seeded_client.patch(
        f"/process/wo/{wo['ID']}/stages/{stages[0]['STAGE_ID']}",
        json={"STATUS": "DONE"}
    )

    seeded_client.patch(
        f"/process/wo/{wo['ID']}/stages/{stages[1]['STAGE_ID']}",
        json={"STATUS": "DONE"}
    )

    gantt = seeded_client.get(f"/process/wo/{wo['ID']}/gantt").json()

    assert gantt["completed_count"] == 2


# ---- BOM classification ----------------------------------------

@pytest.mark.integration
def test_reclassify_bom_item_to_process(seeded_client, db_session):

    from app.models.models import BOMItem, ProductModel, ProcessStage

    snack = (
        db_session.query(ProductModel)
        .filter(ProductModel.MODEL_CODE == "BVC-SBC-01")
        .first()
    )

    bom_item = (
        db_session.query(BOMItem)
        .filter(BOMItem.PRODUCT_MODEL_ID == snack.ID)
        .first()
    )

    stage = (
        db_session.query(ProcessStage)
        .filter(ProcessStage.PRODUCT_MODEL_ID == snack.ID)
        .first()
    )

    res = seeded_client.patch(
        f"/process/bom-items/{bom_item.ID}/classify",
        json={
            "ITEM_TYPE": "PROCESS",
            "PROCESS_STAGE_ID": stage.ID
        }
    )

    assert res.status_code == 200

    assert res.json()["ITEM_TYPE"] == "PROCESS"

    assert res.json()["PREFERRED_SUPPLIER_ID"] is None
