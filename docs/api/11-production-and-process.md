# API — 11 Production & Process

## Product Models

| Method | Path | Purpose |
|---|---|---|
| POST | `/production/models` | Create |
| GET | `/production/models` | List |
| GET | `/production/models/{id}` | Detail with BOM and stages |
| PATCH | `/production/models/{id}` | Update |
| DELETE | `/production/models/{id}` | Delete |
| POST | `/production/models/{id}/seed-default-bom` | Auto-create 10-stage flow |

## BOM Items

| Method | Path | Purpose |
|---|---|---|
| POST | `/production/models/{id}/bom` | Add BOM line |
| GET | `/production/models/{id}/bom` | List BOM |
| PATCH | `/production/bom/{item_id}` | Update |
| DELETE | `/production/bom/{item_id}` | Remove |
| POST | `/production/bom/{item_id}/upload-image` | Multipart image |
| PATCH | `/bom-items/{item_id}/classify` | Set `ITEM_TYPE = PURCHASE | PROCESS` `{ ITEM_TYPE, PREFERRED_SUPPLIER_ID?, PROCESS_STAGE_ID? }` |

## Process Stages

| Method | Path | Purpose |
|---|---|---|
| POST | `/stages` | Create stage `{ PRODUCT_MODEL_ID, SEQUENCE, STAGE_NAME, STAGE_TYPE, ESTIMATED_HOURS }` |
| GET | `/stages/{model_id}` | List stages for product |
| PATCH | `/stages/{id}` | Update |
| DELETE | `/stages/{id}` | Remove (soft — sets IS_ACTIVE=0) |

## Work Orders

| Method | Path | Purpose |
|---|---|---|
| POST | `/production/work-orders` | Create WO `{ PRODUCT_MODEL_ID, PROJECT_ID, QUANTITY, PLANNED_START_DATE, PLANNED_END_DATE }` |
| GET | `/production/work-orders` | List `?status=` |
| GET | `/production/work-orders/{id}` | Detail |
| PATCH | `/production/work-orders/{id}/status` | Update status `{ STATUS }` |
| DELETE | `/production/work-orders/{id}` | Cancel/delete |
| GET | `/production/dashboard` | Production KPIs |

## Work Order Stage Progress

| Method | Path | Purpose |
|---|---|---|
| POST | `/process/spawn-for-wo/{wo_id}` | Spawn stage rows (idempotent) |
| GET | `/process/wo/{wo_id}/stages` | List stage progress |
| PATCH | `/process/wo/{wo_id}/stages/{stage_id}` | Update `{ STATUS, NOTES?, ASSIGNED_TO_ID? }` |
| GET | `/process/wo/{wo_id}/gantt` | **Gantt timeline (see below)** |

## Gantt Response

`GET /process/wo/{wo_id}/gantt` returns:

```json
{
  "work_order_id": 2,
  "wo_number": "WO-2026-0002",
  "base_date": "2026-05-29",
  "timeline_days": 30,
  "timeline": [
    { "day_number": 1, "date": "2026-05-29",
      "weekday": "Fri", "is_sunday": false, "is_working_day": true },
    ...30 items
  ],
  "stages": [
    {
      "stage_id": 1, "stage_name": "Design Review",
      "stage_type": "DESIGN", "sequence": 1,
      "estimated_hours": 4, "actual_hours": null,
      "days_allocated": 1, "day_number": 1,
      "status": "PENDING",
      "planned_start": "2026-05-29T09:00:00",
      "planned_end": "2026-05-29T18:00:00",
      "planned_start_date": "2026-05-29",
      "planned_end_date": "2026-05-29",
      "actual_start": null, "actual_end": null,
      "notes": null,
      "assignee_id": null,
      "assignee_name": null,
      "assignee_code": null
    },
    ...
  ],
  "total_planned_hours": 86,
  "total_actual_hours": 0,
  "completed_count": 0,
  "failed_count": 0,
  "total_stages": 10,
  "wo_status": "PLANNED"
}
```

### Scheduling rules

- Day 1 = `WO.PLANNED_START_DATE` (or `ACTUAL_START_DATE`, or today).
- One stage = one working day.
- Sundays are skipped.

### Auto-assignment policy

The endpoint does **not** auto-assign employees. It **does** clear stale assignments to sales-role employees (NAME / OCCUPATION / SKILLS / Department.NAME / Designation.TITLE / Role.ROLE_NAME matching `sales` / `marketing` / `ragul`).

See [Module 10 — Production & BOM](../modules/10-production-and-bom.md) for full context.

---

Next: [12 — Quality](./12-quality.md)
