"""
Production & BOM endpoint tests.

Covers:
  - Seed populates 5 machine models with BOMs + process stages
  - /production/models, /models/{id}, /bom, /dashboard
  - Creating a new WO auto-spawns stage progress rows
  - QC gate: cannot move WO to DONE without a PASS inspection
"""

import pytest


# ---- Models ----------------------------------------------------

@pytest.mark.smoke
def test_list_models_returns_seeded_five(seeded_client):

    res = seeded_client.get("/production/models?vendor_id=1")

    assert res.status_code == 200

    models = res.json()

    assert len(models) == 5

    codes = {m["MODEL_CODE"] for m in models}

    assert "BVC-SBC-01" in codes

    assert "BVC-MED-01" in codes


@pytest.mark.integration
def test_model_detail_returns_bom_and_stages(seeded_client):

    # First fetch the Snack Combo model ID
    models = seeded_client.get("/production/models").json()

    snack = next(m for m in models if m["MODEL_CODE"] == "BVC-SBC-01")

    res = seeded_client.get(f"/production/models/{snack['ID']}")

    assert res.status_code == 200

    data = res.json()

    assert data["model"]["MODEL_NAME"] == "Snack & Beverage Combo Machine"

    assert data["bom_item_count"] >= 5

    assert len(data["stages"]) == 10   # COMMON_STAGES has 10 entries


@pytest.mark.integration
def test_bom_items_have_item_type_field(seeded_client):

    models = seeded_client.get("/production/models").json()

    snack = next(m for m in models if m["MODEL_CODE"] == "BVC-SBC-01")

    res = seeded_client.get(f"/production/models/{snack['ID']}/bom")

    assert res.status_code == 200

    bom = res.json()

    assert all(b["ITEM_TYPE"] in ("PURCHASE", "PROCESS") for b in bom)


@pytest.mark.smoke
def test_create_unknown_model_returns_409(seeded_client):
    """SUPPLIER_CODE clash returns 409 from the route."""

    res = seeded_client.post(
        "/production/models",
        json={
            "MODEL_NAME": "Duplicate Combo",
            "MODEL_CODE": "BVC-SBC-01",   # already seeded
            "CATEGORY": "snack-beverage",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 409


# ---- Work Orders -----------------------------------------------

@pytest.mark.smoke
def test_list_work_orders_returns_seeded_five(seeded_client):

    res = seeded_client.get("/production/work-orders?vendor_id=1")

    assert res.status_code == 200

    assert len(res.json()) == 5


@pytest.mark.integration
def test_create_wo_auto_spawns_stage_progress(seeded_client, db_session):

    from app.models.models import WorkOrderStageProgress, ProductModel

    snack = (
        db_session.query(ProductModel)
        .filter(ProductModel.MODEL_CODE == "BVC-SBC-01")
        .first()
    )

    res = seeded_client.post(
        "/production/work-orders",
        json={
            "PRODUCT_MODEL_ID": snack.ID,
            "QUANTITY": 4,
            "NOTES": "Test batch",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 200

    data = res.json()

    wo_id = data["work_order"]["ID"]

    assert data["stages_spawned"] == 10

    rows = (
        db_session.query(WorkOrderStageProgress)
        .filter(WorkOrderStageProgress.WORK_ORDER_ID == wo_id)
        .all()
    )

    assert len(rows) == 10

    assert all(r.STATUS == "PENDING" for r in rows)


@pytest.mark.integration
def test_wo_done_without_qc_pass_returns_409(seeded_client):
    """QC gate: cannot mark DONE without a finalised PASS inspection."""

    wos = seeded_client.get(
        "/production/work-orders?status=IN_PROGRESS"
    ).json()

    assert len(wos) >= 1

    wo = wos[0]

    res = seeded_client.patch(
        f"/production/work-orders/{wo['ID']}/status",
        json={"STATUS": "DONE"}
    )

    assert res.status_code == 409

    assert "QC gate" in res.json()["detail"]


@pytest.mark.integration
def test_wo_in_progress_transition_stamps_actual_start(
    seeded_client, db_session
):

    from app.models.models import WorkOrder

    wo = (
        db_session.query(WorkOrder)
        .filter(WorkOrder.STATUS == "PLANNED")
        .first()
    )

    assert wo is not None

    assert wo.ACTUAL_START_DATE is None

    res = seeded_client.patch(
        f"/production/work-orders/{wo.ID}/status",
        json={"STATUS": "IN_PROGRESS"}
    )

    assert res.status_code == 200

    db_session.refresh(wo)

    assert wo.ACTUAL_START_DATE is not None


# ---- Dashboard --------------------------------------------------

@pytest.mark.smoke
def test_production_dashboard_returns_counts(seeded_client):

    res = seeded_client.get("/production/dashboard?vendor_id=1")

    assert res.status_code == 200

    data = res.json()

    assert "total_work_orders" in data

    assert "by_status" in data

    assert data["total_work_orders"] >= 5
