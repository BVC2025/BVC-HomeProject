# Module 05 — Sales Orders

## 5.1 Purpose

A Sales Order (SO) is the binding contract that follows an approved Quotation. It governs:

- Payment milestones (advance / dispatch / installation).
- Production trigger (auto-spawning Projects + Work Orders).
- Shipping and delivery.
- Final closure of the customer engagement.

This is the **most business-critical module** in BVC24 — every revenue event flows through it.

## 5.2 Screens

- **SalesOrders** (`/sales-orders`) — list with status pills, stat tiles (Awaiting Advance, In Production, Delivered+Closed, Total Order Value).
- **SOEditor** (modal) — create form with payment milestones, advance due date field.
- **SODetail** (modal, sticky-header pattern) — full view with workflow buttons, payment progress, AWAITING_ADVANCE banner, line items, activity timeline.
- **SalesOrderPrint** (`/so-print/:id`) — A4 print layout.

## 5.3 State Machine

```
DRAFT
  │  POST /sales-orders/{id}/confirm
  ▼                  (sends advance request email)
AWAITING_ADVANCE  ─┐
  │                │  POST /sales-orders/{id}/payment   (MILESTONE=ADVANCE)
  │                │  when ADVANCE_RECEIVED ≥ required advance
  ▼                ▼
CONFIRMED
  │  POST /sales-orders/{id}/start-production
  ▼
IN_PRODUCTION
  │  POST /sales-orders/{id}/ship
  ▼
SHIPPED
  │  POST /sales-orders/{id}/deliver
  ▼
DELIVERED
  │  POST /sales-orders/{id}/close
  ▼
CLOSED


(any state except CLOSED) ─cancel─► CANCELLED
```

## 5.4 Payment-Gated Confirmation (Phase 5)

The key business rule: **a Sales Order cannot enter production until the customer's advance payment has been received and recorded.**

### Three configurable milestones (defaults)

| Milestone | Default % | When due |
|---|---|---|
| `ADVANCE` | 50 % | Before production starts |
| `DISPATCH` | 40 % | On dispatch (after SHIPPED) |
| `INSTALLATION` | 10 % | After installation (before CLOSED) |

The percentages are stored on `SalesOrder.ADVANCE_PERCENT`, `DISPATCH_PERCENT`, `INSTALLATION_PERCENT` and must sum to 100. Per-SO customisation is supported.

### The flow

```
1. POST /sales-orders/{id}/confirm
   - Validates current STATUS == DRAFT
   - Ensures ADVANCE_DUE_DATE is set
     (defaults to SO_DATE + 7 days if missing)
   - STATUS := AWAITING_ADVANCE
   - email_service dispatches HTML email:
       * Header: "ADVANCE PAYMENT REQUEST"
       * Highlighted box with:
         - Advance amount (₹ value, % of grand total)
         - Due date
       * Full payment schedule (3 milestones with ₹ amounts)
   - whatsapp_service notifies MD:
       "📩 Sales Order — Awaiting Advance — BVC24"
       SO number, customer, order total, advance amount + due date

2. POST /sales-orders/{id}/payment
   { MILESTONE: "ADVANCE", AMOUNT: 150000, NOTES: "UPI ref ABC123" }
   - Validates milestone, amount > 0
   - Increments SO.ADVANCE_RECEIVED by AMOUNT
   - SalesOrderActivity: PAYMENT_RECEIVED with details
   - CHECK: if STATUS == AWAITING_ADVANCE and
            ADVANCE_RECEIVED >= GRAND_TOTAL × ADVANCE_PERCENT / 100:
       - STATUS := CONFIRMED  (automatic)
       - CONFIRMED_AT := now
       - SalesOrderActivity: CONFIRMED
       - whatsapp_service notifies MD:
         "✅ Sales Order CONFIRMED — Advance Received"

3. POST /sales-orders/{id}/start-production
   - Validates STATUS == CONFIRMED
   - For each SO line with PRODUCT_MODEL_ID set:
     project_from_product_service.create_project_from_product(
         customer_id, product_model_id, quantity,
         target_date=EXPECTED_DELIVERY_DATE,
         notes=f"Auto-spawned from {SO_NUMBER} (line #...)"
     )
     - Creates Project row
     - Creates Tasks from product's process stages
     - Creates WorkOrder(s)
     - Sets SO line's SPAWNED_PROJECT_ID
   - STATUS := IN_PRODUCTION
   - PRODUCTION_STARTED_AT := now
   - SalesOrderActivity: PROJECTS_SPAWNED with count
```

### UI affordances

- The SO detail modal displays an **amber AWAITING_ADVANCE banner** with the advance amount and due date when in that state.
- The action button changes by status:
  - DRAFT: **📤 Send Advance Request**
  - AWAITING_ADVANCE: **💰 Record Advance Payment** (pre-fills the milestone and amount)
  - CONFIRMED: **🏭 Start Production**
  - IN_PRODUCTION: **🚚 Ship**
  - SHIPPED: **📦 Mark Delivered**
  - DELIVERED/SHIPPED: **🎉 Close**
  - Most states: **💰 Record Payment**, **🖨️ Print / PDF**, **❌ Cancel**

## 5.5 Conversion from Quotation

```
POST /sales-orders/from-quotation
{ QUOTATION_ID, EXPECTED_DELIVERY_DATE,
  ADVANCE_PERCENT, DISPATCH_PERCENT, INSTALLATION_PERCENT,
  NOTES, VENDOR_ID }
```

- Validates quotation is `APPROVED` (not yet `CONVERTED`).
- Copies header (customer, terms, totals).
- Copies every line 1-to-1 (description, HSN, qty, price, discount, product model).
- Sets `SO.QUOTATION_ID` and `SOLine.QUOTATION_LINE_ID` for traceability.
- Marks the source quotation `CONVERTED`.
- Fires a WhatsApp MD alert: "🏆 Quotation CONVERTED to Sales Order".

## 5.6 Project Auto-Spawning

Each SO line with a `PRODUCT_MODEL_ID` produces exactly one Project on `start-production`. The Project:

- Inherits the customer.
- Carries `QUANTITY` from the SO line (so a single line of 5 units = one project building 5 units).
- Spawns Tasks from the product's process stages (Design Review, Mechanical Design, Electrical Design, Sheet Metal Fabrication, Electrical Wiring, Component Assembly, Software Flashing, Bench Testing, Pre-Dispatch QC, Packaging & Dispatch).
- Each task carries the estimated hours from the stage.
- Tasks remain unassigned by default (per the operational rule that auto-assignment was removed) — admin assigns from the Production / Gantt views.

Lines without `PRODUCT_MODEL_ID` are skipped (they're free-text accessory lines), and the start-production call returns the skip count.

## 5.7 Payment Tracking

The SO detail modal shows a `Payment Progress` card:

- Total bar: `PAYMENT_RECEIVED_TOTAL / GRAND_TOTAL` with percentage.
- Three milestone tiles (Advance, On Dispatch, On Installation):
  - Each shows received / expected in ₹.
  - Filled green when ≥99.99 % paid, amber otherwise.

`SalesOrder` carries the running totals: `ADVANCE_RECEIVED`, `DISPATCH_RECEIVED`, `INSTALLATION_RECEIVED`. Computed fields on the API response:

- `PAYMENT_RECEIVED_TOTAL` = sum of three milestones.
- `PAYMENT_PENDING` = `GRAND_TOTAL` − received.
- `PAYMENT_PROGRESS_PCT` = received / total × 100, rounded.

## 5.8 Cancellation

```
POST /sales-orders/{id}/cancel
{ CANCEL_REASON }
```

- Allowed from any state except `CLOSED` and `CANCELLED`.
- `STATUS := CANCELLED`, `CANCELLED_AT`, `CANCEL_REASON` recorded.
- Spawned Projects and Work Orders are NOT auto-cancelled — production teams have already invested time. Manual closure is required at the project layer.

## 5.9 WhatsApp MD Alerts

| Event | Endpoint | Alert content |
|---|---|---|
| Awaiting advance | `POST /confirm` | SO #, customer, order total, advance amount + due date |
| Auto-confirmed | `POST /payment` (advance complete) | SO #, customer, advance received, order total |
| Quotation → SO | `POST /sales-orders/from-quotation` | SO #, source quote, customer, grand total |

## 5.10 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /sales-orders` | Create SO (header + lines) |
| `GET /sales-orders` | List with filters |
| `GET /sales-orders/{id}` | Detail with lines and computed payment fields |
| `PATCH /sales-orders/{id}` | Update header |
| `DELETE /sales-orders/{id}` | Delete (DRAFT/CANCELLED only) |
| `POST /sales-orders/{id}/lines` | Add line |
| `PATCH /sales-orders/{id}/lines/{lid}` | Update line |
| `DELETE /sales-orders/{id}/lines/{lid}` | Remove line |
| `POST /sales-orders/{id}/confirm` | Send advance request + AWAITING_ADVANCE |
| `POST /sales-orders/{id}/start-production` | Spawn projects + IN_PRODUCTION |
| `POST /sales-orders/{id}/ship` | SHIPPED |
| `POST /sales-orders/{id}/deliver` | DELIVERED |
| `POST /sales-orders/{id}/close` | CLOSED |
| `POST /sales-orders/{id}/cancel` | CANCELLED |
| `POST /sales-orders/{id}/payment` | Record milestone payment |
| `POST /sales-orders/from-quotation` | Convert approved quote |
| `GET /sales-orders/{id}/activity` | Audit timeline |

## 5.11 Data Model

`sales_order`, `sales_order_line`, `sales_order_activity` — see [Schema §6.3](../06-database-schema.md#63-sales).

Notable computed columns returned by `GET /sales-orders/{id}`:

- `ADVANCE_AMOUNT` = `GRAND_TOTAL × ADVANCE_PERCENT / 100`
- `DISPATCH_AMOUNT` = same formula
- `INSTALLATION_AMOUNT` = same formula
- `PAYMENT_RECEIVED_TOTAL`, `PAYMENT_PENDING`, `PAYMENT_PROGRESS_PCT`

---

Next: [Module 06 — Purchase Orders](./06-purchase-orders.md)
