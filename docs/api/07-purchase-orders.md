# API — 07 Purchase Orders

## CRUD

| Method | Path | Purpose |
|---|---|---|
| POST | `/purchase-orders` | Create header + lines |
| GET | `/purchase-orders` | List `?status=&supplier_id=` |
| GET | `/purchase-orders/{id}` | Detail |
| PATCH | `/purchase-orders/{id}` | Update header |
| DELETE | `/purchase-orders/{id}` | Delete (DRAFT/CANCELLED only) |
| POST | `/purchase-orders/{id}/lines` | Add line |
| PATCH | `/purchase-orders/{id}/lines/{lid}` | Update line |
| DELETE | `/purchase-orders/{id}/lines/{lid}` | Remove line |

## Workflow

| Method | Path | Purpose |
|---|---|---|
| POST | `/purchase-orders/{id}/send` | STATUS → SENT, email supplier |
| POST | `/purchase-orders/{id}/resend-email` | Re-dispatch |
| POST | `/purchase-orders/{id}/confirm` | STATUS → CONFIRMED |
| POST | `/purchase-orders/{id}/cancel` | STATUS → CANCELLED |

## GRN

| Method | Path | Purpose |
|---|---|---|
| POST | `/purchase-orders/{id}/grn` | Create GRN draft `{ RECEIVED_DATE, INVOICE_NUMBER, LINES: [...] }` |
| GET | `/purchase-orders/{id}/grn` | List GRNs for PO |
| GET | `/purchase-orders/grn/{grn_id}` | GRN detail |
| POST | `/purchase-orders/grn/{grn_id}/finalize` | FINAL + push to inventory |
| POST | `/purchase-orders/grn/{grn_id}/resend-rejection-notice` | Email supplier |
| DELETE | `/purchase-orders/grn/{grn_id}` | Delete DRAFT GRN |

### GRN create payload

```json
{
  "RECEIVED_DATE": "2026-06-10",
  "RECEIVED_BY": "<employee-uuid>",
  "INVOICE_NUMBER": "INV-2026-1234",
  "LINES": [
    { "PO_LINE_ID": 33, "QUANTITY_RECEIVED": 50,
      "QUANTITY_REJECTED": 2, "REJECTION_REASON": "dented" }
  ]
}
```

## Auto-PO from Project

| Method | Path | Purpose |
|---|---|---|
| POST | `/purchase-orders/auto-from-project` | Generate POs from project BOM `{ PROJECT_ID }` |

## Activity

| Method | Path | Purpose |
|---|---|---|
| GET | `/purchase-orders/{id}/activity` | Timeline |
| DELETE | `/purchase-orders/{id}/activity/{aid}` | Admin clean-up |

See [Module 06 — Purchase Orders](../modules/06-purchase-orders.md) for state machine and GRN flow.

---

Next: [08 — Suppliers](./08-suppliers.md)
