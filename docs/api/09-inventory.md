# API — 09 Inventory

## Material Catalog

| Method | Path | Purpose |
|---|---|---|
| GET | `/materials-catalog` | Master list |
| PUT | `/materials-catalog/{id}/departments` | Scope to departments `{ DEPARTMENT_IDS: [...] }` |
| GET | `/materials/for-me` | Filtered by current employee's department |
| POST | `/seed-materials` | Seed demo catalog (dev) |
| POST | `/create-material` | Create `{ MATERIAL_NAME, UNIT, REORDER_LEVEL, UNIT_PRICE }` |
| GET | `/materials` | List with stock |
| PUT | `/update-stock/{id}` | Direct stock update `{ QUANTITY }` (admin only) |
| DELETE | `/delete-material/{id}` | Remove |

## Inventory

| Method | Path | Purpose |
|---|---|---|
| GET | `/inventory/full` | Enriched list with category, status, value |
| POST | `/inventory/{id}/adjust` | Stock movement `{ TYPE: RECEIPT|ISSUE|COUNT, QUANTITY, UNIT_PRICE?, REASON, REFERENCE? }` |
| GET | `/inventory/{id}/movements` | Movement history |

### `/inventory/full` response

```json
[
  {
    "INVENTORY_ID": 14,
    "MATERIAL_ID": 7,
    "MATERIAL_NAME": "GI Sheet 1.2mm",
    "CATEGORY": "Sheet Metal",
    "CATEGORY_EMOJI": "🪙",
    "QUANTITY": 12,
    "REORDER_LEVEL": 30,
    "UNIT_PRICE": 8500,
    "STOCK_VALUE": 102000,
    "STATUS": "LOW_STOCK"
  }, ...
]
```

See [Module 08 — Inventory](../modules/08-inventory.md).

---

Next: [10 — Projects & Tasks](./10-projects-and-tasks.md)
