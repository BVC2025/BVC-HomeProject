# Module 06 — Purchase Orders

## 6.1 Purpose

The Purchase Order (PO) module manages the procurement side of manufacturing:

- Issue POs to suppliers for raw materials or sub-assemblies.
- Track deliveries via Goods Receipt Notes (GRN), including partial receipts and quality rejections.
- Push received quantities into Inventory automatically upon GRN finalisation.
- Auto-generate POs from a Project's BOM, grouped by supplier.

## 6.2 Screens

- **PurchaseOrders** (`/purchase-orders`) — list with status filters.
- **POEditor** (modal) — create form with line items.
- **PODetail** (modal, sticky-header pattern) — full view with workflow buttons (Send, Confirm, Record GRN, Cancel, Print).
- **GRN drawer** — record goods received with per-line quantity and rejection reason.
- **PurchaseOrderPrint** (`/po-print/:id`) — A4 print layout.
- **GRNPrint** (`/grn-print/:id`) — A4 GRN layout.

## 6.3 State Machine

```
DRAFT
  │  POST /purchase-orders/{id}/send
  ▼
SENT
  │  POST /purchase-orders/{id}/confirm
  ▼
CONFIRMED
  │  POST /purchase-orders/{id}/grn   (first partial GRN)
  ▼
PARTIAL_RECEIVED
  │  POST /purchase-orders/{id}/grn   (final delivery)
  ▼
RECEIVED

(any non-RECEIVED) ─cancel─► CANCELLED
```

## 6.4 Workflow

```
1. POST /purchase-orders
   { SUPPLIER_ID, PO_DATE, EXPECTED_DELIVERY_DATE,
     DELIVERY_ADDRESS, LINKED_PROJECT_ID,
     LINES: [ { MATERIAL_ID, DESCRIPTION, QUANTITY,
                UNIT, UNIT_PRICE, DISCOUNT_PERCENT }, ... ] }
   → STATUS=DRAFT, totals computed
   → PurchaseOrderActivity: CREATED

2. POST /purchase-orders/{id}/send
   → STATUS=SENT
   → email_service dispatches HTML PO email to supplier
   → PurchaseOrderActivity: SENT, EMAIL_SENT

3. POST /purchase-orders/{id}/confirm
   → STATUS=CONFIRMED
   → PurchaseOrderActivity: CONFIRMED

4. POST /purchase-orders/{id}/grn
   { RECEIVED_DATE, INVOICE_NUMBER,
     LINES: [ { PO_LINE_ID, QUANTITY_RECEIVED,
                QUANTITY_REJECTED, REJECTION_REASON }, ... ] }
   → GoodsReceiptNote (STATUS=DRAFT) + GoodsReceiptLine rows
   → PurchaseOrderActivity: GRN_RECORDED

5. POST /purchase-orders/grn/{grn_id}/finalize
   → GRN.STATUS = FINAL
   → Inventory.QUANTITY incremented for each received line
   → POLine.QUANTITY_RECEIVED accumulated
   → PO.STATUS updated:
       all lines fully received → RECEIVED
       partial across any line  → PARTIAL_RECEIVED
   → PurchaseOrderActivity: RECEIVED or PARTIAL_RECEIVED
```

## 6.5 GRN — Partial Receipts and Rejections

A single PO may have multiple GRNs:

- First delivery: partial → `GRN-001` with quantities for what arrived.
- Second delivery: balance → `GRN-002` with remaining quantities.

Each GRN line tracks both `QUANTITY_RECEIVED` and `QUANTITY_REJECTED` (with `REJECTION_REASON`). Only `QUANTITY_RECEIVED` is added to inventory on finalisation.

Rejected quantities can trigger a **rejection notice** to the supplier:

```
POST /purchase-orders/grn/{grn_id}/resend-rejection-notice
```

Sends an email summarising the rejection with reason — useful for replacement / credit-note negotiations.

## 6.6 Auto-PO from Project

```
POST /purchase-orders/auto-from-project
{ PROJECT_ID }
```

Walks the project's product model BOM:

1. Filter for `ITEM_TYPE = PURCHASE` (sourced lines).
2. Group by `PREFERRED_SUPPLIER_ID`.
3. For each supplier, create one PO with all their lines.
4. Each PO line carries `MATERIAL_ID`, `BOM_ITEM_ID` (for traceability), quantity, and unit price from the BOM (or last-known supplier price).

This dramatically accelerates procurement: a project with 30 BOM items across 5 suppliers becomes 5 POs in one click.

## 6.7 Email Delivery

Email transport via `email_service.py` (Resend or SMTP). The PO email contains:

- BVC24 header.
- PO number, date, delivery address, expected delivery date.
- Line items table.
- Subtotal, discount, tax, grand total.
- Payment terms (from supplier defaults).
- Authorized signatory section.

`POST /purchase-orders/{id}/resend-email` re-dispatches without changing state.

## 6.8 Activity Timeline

`GET /purchase-orders/{id}/activity`:

- `CREATED`, `LINE_ADDED/UPDATED/REMOVED`
- `SENT`, `EMAIL_SENT`, `EMAIL_FAILED`
- `CONFIRMED`
- `GRN_RECORDED`, `GRN_FINALIZED`
- `PARTIAL_RECEIVED`, `RECEIVED`
- `REJECTION_NOTICE_SENT`
- `CANCELLED`

Each row carries `ACTOR_TYPE` distinguishing `SYSTEM`, `WAREHOUSE` (GRN records), `SUPPLIER` (responses), `SALES` (admin-recorded actions).

## 6.9 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /purchase-orders` | Create |
| `GET /purchase-orders` | List |
| `GET /purchase-orders/{id}` | Detail |
| `PATCH /purchase-orders/{id}` | Update header |
| `DELETE /purchase-orders/{id}` | Delete (DRAFT/CANCELLED only) |
| `POST /purchase-orders/{id}/lines` | Add line |
| `PATCH /purchase-orders/{id}/lines/{lid}` | Update line |
| `DELETE /purchase-orders/{id}/lines/{lid}` | Remove line |
| `POST /purchase-orders/{id}/send` | Mark SENT + email supplier |
| `POST /purchase-orders/{id}/resend-email` | Re-dispatch |
| `POST /purchase-orders/{id}/confirm` | Mark CONFIRMED |
| `POST /purchase-orders/{id}/cancel` | Mark CANCELLED |
| `POST /purchase-orders/{id}/grn` | Record GRN (DRAFT) |
| `GET /purchase-orders/{id}/grn` | List GRNs for PO |
| `GET /purchase-orders/grn/{grn_id}` | GRN detail |
| `POST /purchase-orders/grn/{grn_id}/finalize` | Push to inventory |
| `POST /purchase-orders/grn/{grn_id}/resend-rejection-notice` | Notify supplier |
| `DELETE /purchase-orders/grn/{grn_id}` | Delete DRAFT GRN |
| `GET /purchase-orders/{id}/activity` | Timeline |
| `POST /purchase-orders/auto-from-project` | Auto-generate from project BOM |

## 6.10 Data Model

`purchase_order`, `purchase_order_line`, `goods_receipt_note`, `goods_receipt_line`, `purchase_order_activity` — see [Schema §6.4](../06-database-schema.md#64-purchase).

---

Next: [Module 07 — Suppliers](./07-suppliers.md)
