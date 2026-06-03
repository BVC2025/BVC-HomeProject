# Module 04 — Quotations

## 4.1 Purpose

A Quotation is a formal, dated, customer-facing price offer. It carries line items, taxes, totals, validity period, and terms. Once the customer approves, it is converted into a Sales Order — the binding contract.

## 4.2 Screens

- **Quotations** (`/quotations`) — list with status filters (Draft / Sent / Approved / Rejected / Converted).
- **QuotationEditor** (modal) — header form + line items grid.
- **QuotationDetail** (modal, sticky-header pattern) — full view with workflow buttons (Send, Approve, Reject, Convert to SO, Resend Email, Print, Public Link).
- **QuotationPrint** (`/quotation-print/:id`) — A4 print layout.
- **PublicQuotation** (`/q/:token`) — customer-facing read-only view served without authentication.

## 4.3 State Machine

```
DRAFT ─send──► SENT ─approve──► APPROVED ─convert──► CONVERTED
   │             │                  │
   │             │                  └─reject──► REJECTED
   │             └─reject──► REJECTED
   │
   └─edit/delete (DRAFT only)

(any non-CONVERTED) ─expiry-date-passed─► EXPIRED
```

State transitions:

- **DRAFT**: editable. Lines can be added/edited/removed.
- **SENT**: email dispatched, `PUBLIC_TOKEN` generated, customer can view via `/q/{token}`.
- **APPROVED**: customer clicked "Approve" on the public link or admin manually approved.
- **REJECTED**: customer rejected with reason, or admin recorded internal rejection.
- **CONVERTED**: a Sales Order was created from this quotation (via `POST /sales-orders/from-quotation`). The link is preserved via `SalesOrder.QUOTATION_ID`.
- **EXPIRED**: passed `EXPIRY_DATE` without resolution (cron-driven or computed on read).

## 4.4 Workflow

### Standard flow

```
1. POST /quotations
   { CUSTOMER_ID, QUOTATION_DATE, VALIDITY_DAYS,
     DISCOUNT_PERCENT, TAX_PERCENT, TERMS,
     LINES: [ { PRODUCT_MODEL_ID, DESCRIPTION, QUANTITY,
                UNIT_PRICE, DISCOUNT_PERCENT }, ... ] }
   → Quotation header (STATUS=DRAFT) + N QuotationLine rows
   → Totals computed: SUBTOTAL, DISCOUNT_AMOUNT, TAX_AMOUNT, GRAND_TOTAL
   → QuotationActivity row: CREATED

2. POST /quotations/{id}/send
   → STATUS = SENT
   → PUBLIC_TOKEN = secrets.token_urlsafe(24)
   → EMAIL_SENT_AT, EMAIL_SENT_COUNT++
   → email_service dispatches HTML email with the
     "View & Respond" button → /q/{token}

3. Customer opens /q/{token}
   → GET /q/{token} → renders HTML view (no auth required)
   → VIEWED_AT, LAST_VIEWED_AT, VIEW_COUNT++ updated
   → QuotationActivity: VIEWED

4. Customer clicks Approve or Reject on the public page
   → POST /q/{token}/respond { ACTION: "approve" | "reject", REASON? }
   → STATUS = APPROVED or REJECTED
   → QuotationActivity: APPROVED / REJECTED with ACTOR_TYPE=CUSTOMER

5. Admin converts approved quote to Sales Order
   → POST /sales-orders/from-quotation { QUOTATION_ID, ... }
   → New SO in DRAFT, all lines copied 1-to-1
   → Source quotation STATUS = CONVERTED
```

### Auto-pricing from BOM

`POST /quotations/from-requirements` builds a quotation automatically from one or more `CustomerRequirement` rows:

- For each requirement with a `PRODUCT_MODEL_ID`, pricing is computed from the model's BOM:
  - Sum of `Σ (BOMItem.QUANTITY × UnitPrice)` for PURCHASE items (from supplier's last known unit price or `BOMItem.UNIT_PRICE`).
  - Add a margin (default 25%, configurable per vendor).
- Lines are created with description, HSN code, quantity, and computed unit price.
- The resulting quotation is in `DRAFT` and editable before sending.

`GET /quotations/auto-price?product_model_id=X` returns the auto-computed price for a single model without creating a quotation.

## 4.5 Public Share Link

The customer-facing flow uses a token-gated route — no portal account required.

- URL: `<FRONTEND_BASE_URL>/q/{PUBLIC_TOKEN}`
- The token is unique per quotation, URL-safe, and not enumerable.
- Telemetry: every view records `VIEWED_AT`, `LAST_VIEWED_AT`, and `VIEW_COUNT`.
- The customer sees a clean read-only page with the line items, totals, terms, and two action buttons (Approve, Reject).
- Approve/Reject writes an activity entry with `ACTOR_TYPE=CUSTOMER`.

## 4.6 Email Delivery

Email transport is handled by `email_service.py`:

1. If `RESEND_API_KEY` is set, Resend HTTP API is used.
2. Otherwise, SMTP (with `SMTP_HOST`, `SMTP_PORT`, credentials, TLS settings).
3. If neither is configured, the call returns `(False, "no transport configured")` and the quotation operation continues — the quotation is still marked SENT in the UI with a warning.

The email body is a styled HTML template with the BVC red header, line-item summary, grand total in bold, validity warning, and a single primary CTA button to view the quote.

`POST /quotations/{id}/resend-email` re-dispatches without changing state.

## 4.7 Print Layout

`GET /quotation-print/:id` renders an A4-optimised page:

- BVC24 header with logo and company info
- Quotation number, date, validity
- Customer billing block
- Line items table (description, HSN, qty, unit price, discount, total)
- Subtotal, discount, tax breakdown, grand total
- Terms & conditions
- Authorized signatory section

The page uses CSS `@media print` rules to hide navigation chrome and produce a clean single-document PDF via the browser's print-to-PDF feature.

## 4.8 Activity Timeline

`GET /quotations/{id}/activity` returns the audit timeline:

- `CREATED` — first save
- `LINE_ADDED` / `LINE_REMOVED` / `LINE_UPDATED`
- `SENT` — email dispatched
- `EMAIL_SENT` — successful delivery
- `EMAIL_FAILED` — with reason
- `VIEWED` — customer opened public link
- `APPROVED` — customer or admin approval
- `REJECTED` — with reason
- `CONVERTED` — sales order created
- `EXPIRED` — passed expiry date

`DELETE /quotations/{id}/activity/{activity_id}` is provided for admin cleanup but typically not used (audit log).

## 4.9 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /quotations` | Create |
| `GET /quotations` | List with filters |
| `GET /quotations/{id}` | Detail |
| `PATCH /quotations/{id}` | Update header |
| `DELETE /quotations/{id}` | Delete (DRAFT only) |
| `POST /quotations/{id}/lines` | Add line |
| `PATCH /quotations/{id}/lines/{lid}` | Update line |
| `DELETE /quotations/{id}/lines/{lid}` | Remove line |
| `POST /quotations/{id}/send` | Mark SENT + email |
| `POST /quotations/{id}/resend-email` | Re-dispatch |
| `POST /quotations/{id}/approve` | Mark APPROVED |
| `POST /quotations/{id}/reject` | Mark REJECTED |
| `POST /quotations/from-requirements` | Auto-build from requirements |
| `GET /quotations/auto-price` | Suggest price |
| `GET /q/{token}` | Public view (no auth) |
| `POST /q/{token}/respond` | Customer response |
| `GET /quotations/{id}/activity` | Timeline |

## 4.10 Data Model

`quotation`, `quotation_line`, `quotation_activity` — see [Schema §6.3](../06-database-schema.md#63-sales).

---

Next: [Module 05 — Sales Orders](./05-sales-orders.md)
