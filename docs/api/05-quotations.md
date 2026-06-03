# API — 05 Quotations

## CRUD

| Method | Path | Purpose |
|---|---|---|
| POST | `/quotations` | Create with header + lines |
| GET | `/quotations` | List `?customer_id=&status=&from=&to=` |
| GET | `/quotations/{id}` | Detail with lines |
| PATCH | `/quotations/{id}` | Update header (DRAFT only) |
| DELETE | `/quotations/{id}` | Delete (DRAFT only) |
| POST | `/quotations/{id}/lines` | Add line |
| PATCH | `/quotations/{id}/lines/{lid}` | Update line |
| DELETE | `/quotations/{id}/lines/{lid}` | Remove line |

### Create payload

```json
{
  "CUSTOMER_ID": 12,
  "QUOTATION_DATE": "2026-05-29",
  "VALIDITY_DAYS": 30,
  "DISCOUNT_PERCENT": 0,
  "TAX_PERCENT": 18,
  "PREPARED_BY": "<employee-uuid>",
  "TERMS_AND_CONDITIONS": "...",
  "LINES": [
    {
      "PRODUCT_MODEL_ID": 3,
      "DESCRIPTION": "BVC24 Snack & Beverage Combo SS&B-01",
      "HSN_CODE": "84244000",
      "QUANTITY": 2,
      "UNIT": "nos",
      "UNIT_PRICE": 425000,
      "DISCOUNT_PERCENT": 0
    }
  ]
}
```

## Workflow

| Method | Path | Purpose |
|---|---|---|
| POST | `/quotations/{id}/send` | Mark SENT + email customer |
| POST | `/quotations/{id}/resend-email` | Re-dispatch |
| POST | `/quotations/{id}/approve` | Mark APPROVED |
| POST | `/quotations/{id}/reject` | Mark REJECTED `{ REASON }` |

## Auto-generation

| Method | Path | Purpose |
|---|---|---|
| POST | `/quotations/from-requirements` | Auto-build from `{ CUSTOMER_ID, REQUIREMENT_IDS: [...] }` |
| GET | `/quotations/auto-price` | Suggest price `?product_model_id=&margin=` |

## Public Link

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/q/{token}` | None | Public read-only view |
| POST | `/q/{token}/respond` | None | Customer response `{ ACTION: approve|reject, REASON? }` |

## Activity Timeline

| Method | Path | Purpose |
|---|---|---|
| GET | `/quotations/{id}/activity` | Audit timeline |
| DELETE | `/quotations/{id}/activity/{aid}` | Admin clean-up |

See [Module 04 — Quotations](../modules/04-quotations.md) for state machine and email templates.

---

Next: [06 — Sales Orders](./06-sales-orders.md)
