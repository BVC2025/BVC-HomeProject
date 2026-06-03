# API — 06 Sales Orders

## CRUD

| Method | Path | Purpose |
|---|---|---|
| POST | `/sales-orders` | Create header + lines |
| GET | `/sales-orders` | List `?status=&customer_id=&vendor_id=` |
| GET | `/sales-orders/{id}` | Detail with computed payment fields |
| PATCH | `/sales-orders/{id}` | Update header |
| DELETE | `/sales-orders/{id}` | Delete (DRAFT/CANCELLED only) |
| POST | `/sales-orders/{id}/lines` | Add line |
| PATCH | `/sales-orders/{id}/lines/{lid}` | Update line |
| DELETE | `/sales-orders/{id}/lines/{lid}` | Remove line |

### Create payload

```json
{
  "CUSTOMER_ID": 12,
  "QUOTATION_ID": 42,
  "SO_DATE": "2026-05-29",
  "EXPECTED_DELIVERY_DATE": "2026-07-15",
  "ADVANCE_DUE_DATE": "2026-06-05",
  "DISCOUNT_PERCENT": 0,
  "TAX_PERCENT": 18,
  "ADVANCE_PERCENT": 50,
  "DISPATCH_PERCENT": 40,
  "INSTALLATION_PERCENT": 10,
  "SHIPPING_ADDRESS": "...",
  "BILLING_ADDRESS": "...",
  "TERMS_AND_CONDITIONS": "...",
  "PREPARED_BY": "<employee-uuid>",
  "LINES": [...]
}
```

## Workflow (payment-gated)

| Method | Path | Purpose |
|---|---|---|
| POST | `/sales-orders/{id}/confirm` | Send advance request, STATUS → AWAITING_ADVANCE |
| POST | `/sales-orders/{id}/payment` | Record milestone `{ MILESTONE: ADVANCE|DISPATCH|INSTALLATION, AMOUNT, NOTES? }` — auto-confirms if advance fully received |
| POST | `/sales-orders/{id}/start-production` | Spawn projects, STATUS → IN_PRODUCTION |
| POST | `/sales-orders/{id}/ship` | STATUS → SHIPPED |
| POST | `/sales-orders/{id}/deliver` | STATUS → DELIVERED |
| POST | `/sales-orders/{id}/close` | STATUS → CLOSED |
| POST | `/sales-orders/{id}/cancel` | STATUS → CANCELLED `{ CANCEL_REASON }` |

## Conversion

| Method | Path | Purpose |
|---|---|---|
| POST | `/sales-orders/from-quotation` | Convert APPROVED quote `{ QUOTATION_ID, EXPECTED_DELIVERY_DATE, ADVANCE_PERCENT, DISPATCH_PERCENT, INSTALLATION_PERCENT, NOTES, VENDOR_ID }` |

## Activity

| Method | Path | Purpose |
|---|---|---|
| GET | `/sales-orders/{id}/activity` | Timeline |
| DELETE | `/sales-orders/{id}/activity/{aid}` | Admin clean-up |

## Detail response — computed fields

A `GET /sales-orders/{id}` response includes computed values on top of the stored columns:

```json
{
  "ID": 7,
  "SO_NUMBER": "SO-2026-0001",
  ...
  "ADVANCE_AMOUNT": 212500,      // GRAND_TOTAL × ADVANCE_PERCENT / 100
  "DISPATCH_AMOUNT": 170000,
  "INSTALLATION_AMOUNT": 42500,
  "PAYMENT_RECEIVED_TOTAL": 212500,
  "PAYMENT_PENDING": 212500,
  "PAYMENT_PROGRESS_PCT": 50.0,
  "CUSTOMER_NAME": "...", "CUSTOMER_PHONE": "...",
  "QUOTATION_NUMBER": "QUO-2026-0040",
  "PREPARED_BY_NAME": "...",
  "LINES": [...]
}
```

See [Module 05 — Sales Orders](../modules/05-sales-orders.md) for state machine and payment-gated workflow.

---

Next: [07 — Purchase Orders](./07-purchase-orders.md)
