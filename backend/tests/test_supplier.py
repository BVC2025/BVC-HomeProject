"""
Supplier master endpoint tests.

Covers:
  - Seed creates 7 categorised suppliers
  - CRUD lifecycle: create, list, get, patch, delete (soft)
  - Code uniqueness enforced (409)
  - Search + category + status filters
"""

import pytest


@pytest.mark.smoke
def test_list_seeded_suppliers(seeded_client):

    res = seeded_client.get("/suppliers?vendor_id=1")

    assert res.status_code == 200

    rows = res.json()

    assert len(rows) == 7

    categories = {r["CATEGORY"] for r in rows}

    assert "Electronics" in categories

    assert "Motors" in categories

    assert "Sheet Metal" in categories


@pytest.mark.smoke
def test_supplier_categories_endpoint(seeded_client):

    res = seeded_client.get("/suppliers/categories?vendor_id=1")

    assert res.status_code == 200

    cats = res.json()

    assert isinstance(cats, list)

    assert "Electronics" in cats


@pytest.mark.integration
def test_create_then_get_supplier(seeded_client):

    create_res = seeded_client.post(
        "/suppliers",
        json={
            "SUPPLIER_CODE": "SUP-TEST-01",
            "COMPANY_NAME": "Test Supply Co",
            "CONTACT_PERSON": "Test Contact",
            "PHONE": "+91 9999999999",
            "EMAIL": "test@test.com",
            "GST_NUMBER": "33TESTGST1234A1Z5",
            "CATEGORY": "Electronics",
            "VENDOR_ID": 1
        }
    )

    assert create_res.status_code == 200

    new_id = create_res.json()["supplier"]["ID"]

    detail = seeded_client.get(f"/suppliers/{new_id}").json()

    assert detail["supplier"]["SUPPLIER_CODE"] == "SUP-TEST-01"

    assert detail["bom_items_linked"] == 0


@pytest.mark.smoke
def test_create_duplicate_code_returns_409(seeded_client):

    res = seeded_client.post(
        "/suppliers",
        json={
            "SUPPLIER_CODE": "SUP-MOTOR-01",   # already seeded
            "COMPANY_NAME": "Duplicate",
            "VENDOR_ID": 1
        }
    )

    assert res.status_code == 409


@pytest.mark.integration
def test_filter_by_category(seeded_client):

    res = seeded_client.get(
        "/suppliers?vendor_id=1&category=Motors"
    )

    assert res.status_code == 200

    rows = res.json()

    assert len(rows) >= 1

    assert all(r["CATEGORY"] == "Motors" for r in rows)


@pytest.mark.integration
def test_search_by_company_name(seeded_client):

    res = seeded_client.get(
        "/suppliers?vendor_id=1&search=Bangalore"
    )

    assert res.status_code == 200

    rows = res.json()

    assert len(rows) >= 1

    assert any("Bangalore" in r["COMPANY_NAME"] for r in rows)


@pytest.mark.integration
def test_patch_and_soft_delete(seeded_client):

    suppliers = seeded_client.get("/suppliers").json()

    target = suppliers[0]

    patch_res = seeded_client.patch(
        f"/suppliers/{target['ID']}",
        json={"PAYMENT_TERMS": "NET 60", "CONTACT_PERSON": "Updated Name"}
    )

    assert patch_res.status_code == 200

    assert patch_res.json()["supplier"]["PAYMENT_TERMS"] == "NET 60"

    del_res = seeded_client.delete(f"/suppliers/{target['ID']}")

    assert del_res.status_code == 200

    refreshed = seeded_client.get(f"/suppliers/{target['ID']}").json()

    assert refreshed["supplier"]["STATUS"] == "INACTIVE"
