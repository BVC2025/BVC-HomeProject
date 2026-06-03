# API — 12 Quality Management

## Checklists

| Method | Path | Purpose |
|---|---|---|
| POST | `/quality/checklist-items` | Create check `{ PRODUCT_MODEL_ID, SEQUENCE, CHECK_POINT, DESCRIPTION, SEVERITY }` |
| GET | `/quality/checklist/{model_id}` | List checks for product |
| PATCH | `/quality/checklist-items/{id}` | Update |
| DELETE | `/quality/checklist-items/{id}` | Remove (soft) |

## Inspections

| Method | Path | Purpose |
|---|---|---|
| POST | `/quality/inspections` | Create inspection `{ WORK_ORDER_ID, INSPECTOR_ID }` — auto-creates result rows |
| GET | `/quality/inspections` | List with filters |
| GET | `/quality/inspections/{id}` | Detail with all results |
| PATCH | `/quality/results/{result_id}` | Record per-item result `{ RESULT, NOTES }` |
| POST | `/quality/inspections/{id}/finalise` | Lock inspection + auto-open NCRs for failures |

## NCRs

| Method | Path | Purpose |
|---|---|---|
| GET | `/quality/ncrs` | List with filters `?status=&severity=&work_order_id=` |
| PATCH | `/quality/ncrs/{id}` | Update `{ STATUS, ROOT_CAUSE?, CORRECTIVE_ACTION?, ASSIGNED_TO_ID? }` |

## Dashboard

| Method | Path | Purpose |
|---|---|---|
| GET | `/quality/dashboard` | KPIs (inspections this month, pass-rate, open NCRs, top failing checks) |

See [Module 11 — Quality Management](../modules/11-quality.md) for severity policy and WO gate.

---

Next: [13 — Machines](./13-machines.md)
