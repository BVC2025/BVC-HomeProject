# Module 16 — Print & Public Links

## 16.1 Purpose

BVC24 produces **A4 print documents** for every major business artifact (Quotation, Sales Order, Purchase Order, GRN), and provides **public unauthenticated share links** for customer-facing documents. These two features turn the ERP into a complete document-of-record system without needing a separate PDF library.

## 16.2 Print Views

Four print pages, each available at a stable URL pattern:

| Page | Route | Purpose |
|---|---|---|
| **QuotationPrint** | `/quotation-print/:id` | Quote for customer signature |
| **SalesOrderPrint** | `/so-print/:id` | SO copy for production & customer |
| **PurchaseOrderPrint** | `/po-print/:id` | PO for supplier delivery & invoicing |
| **GRNPrint** | `/grn-print/:id` | Goods receipt record |

### Layout principles

Each print page renders:

- **Header band** with BVC24 logo, address, GST, email, phone, web URL.
- **Document title** with number (e.g. `QUOTATION QUO-2026-0042`), date, validity / expected delivery.
- **Party block** — customer or supplier billing details.
- **Line items table** — description / HSN / qty / unit price / discount / total.
- **Totals block** — subtotal, discount, taxable, GST, grand total. Rounded in bold.
- **Terms & conditions** — multiline text block.
- **Footer** — authorized signatory, BVC red accent line.

### CSS @media print rules

Each page uses `@media print` to:

- Hide app chrome (sidebar, header, navigation).
- Fix page size to A4 portrait.
- Ensure colours (BVC red) survive print colour-fidelity settings.
- Avoid page breaks inside line-item rows.

### PDF generation

There is no server-side PDF library. Users press **Ctrl+P** (or click the **🖨️ Print / PDF** button in the detail modal) and select **"Save as PDF"** from the browser print dialog. Modern Chrome/Edge produce a clean A4 PDF with this approach — equivalent quality to wkhtmltopdf, no Python dependency.

## 16.3 Public Quotation Link

The marquee public feature.

### URL pattern

```
<FRONTEND_BASE_URL>/q/<PUBLIC_TOKEN>
```

Example: `https://erp.bvc24.in/q/Vq8zJk-aP2x9N1tR-yL3fK6pW`.

### Server endpoint

```
GET /q/{token}
```

- Looks up the quotation by `PUBLIC_TOKEN` (unique, URL-safe, 32 chars).
- Returns a rendered HTML page (or JSON for an SPA-style view, depending on the client) with:
  - Read-only line items
  - Totals
  - Validity warning
  - Two action buttons: ✅ Approve, ❌ Reject
- Increments `VIEWED_AT`, `LAST_VIEWED_AT`, `VIEW_COUNT`.
- Writes a `QuotationActivity` row: `VIEWED` with `ACTOR_TYPE=CUSTOMER`.

### Response endpoint

```
POST /q/{token}/respond
{ ACTION: "approve" | "reject", REASON?: "..." }
```

- Updates `Quotation.STATUS` to `APPROVED` or `REJECTED`.
- Writes a `QuotationActivity` row: `APPROVED` or `REJECTED` with `ACTOR_TYPE=CUSTOMER`.
- Returns a thank-you page or JSON acknowledgement.

### Why no portal account for the customer?

- Customers send a procurement contact a quote; that contact needs to approve quickly, not create yet-another-portal-login.
- The token is opaque and URL-safe — sharing the link is equivalent to sharing the document.
- Approval is single-use: once `STATUS != SENT`, subsequent approve attempts return 409 Conflict.

### Security considerations

- Tokens are 32 URL-safe chars (`secrets.token_urlsafe(24)`) — effectively unguessable.
- Tokens never appear in URL referrer logs because the link is opened from email, not from another web page.
- A token is per-quotation; even if leaked, the worst case is an unauthorised view of one quote.

## 16.4 Other Public Routes

| Route | Purpose | Auth |
|---|---|---|
| `/biometric` | Tablet kiosk check-in | None (device on local network) |
| `/apply-leave` | Employee leave form deep-link | None when reached via deep link |
| `/q/:token` | Public quotation view | Token in URL |
| `/q/:token/respond` | Public quotation response | Token in URL |
| `GET /approve-task?token=...` | Task approval from email | Token in URL |
| `GET /reject-task?token=...` | Task rejection from email | Token in URL |
| `GET /leave/decide/{token}?action=...` | Leave decision from email | Token in URL |

All approval-token endpoints become **inert after first use** (`APPROVAL_RESOLVED_AT` is set). Re-clicks return the resolution page (not the form) so the approver can confirm their action took effect.

## 16.5 Print View Implementation Pattern

Each print page is a standalone React component that:

1. Reads the document ID from the URL params.
2. Fetches the full document from the relevant API (`GET /quotations/{id}`, `GET /sales-orders/{id}`, etc.).
3. Renders a self-contained page with inline `<style>` for print rules.
4. Auto-triggers `window.print()` 500 ms after data loads (optional — UX choice).

The pattern is intentionally simple — no PDF library, no server template engine, no separate report tool. This keeps the bundle small and makes print-layout changes trivial (just CSS).

## 16.6 Email Attachment vs. Public Link

The Quotation/SO/PO emails currently include the public link rather than a PDF attachment. Rationale:

- **Always up-to-date** — if a quote is edited after sending (rare but possible), the link reflects the current state.
- **Telemetry** — the public view records `VIEW_COUNT` and timestamps; an attachment cannot.
- **No size limits** — large quotations with many lines don't bump into SMTP attachment size limits.
- **Customer can save as PDF** themselves from the public view.

A PDF attachment variant is on the roadmap for customers who explicitly request it.

## 16.7 Branding

All print views use the **BVC red palette**:

- Primary header band: `linear-gradient(135deg, #C8102E, #8B0B1F)`
- Accent line / total emphasis: `#C8102E`
- Gold highlight: `#F4B324` (used sparingly for "Advance Due" call-outs)
- Body text: `#0f172a`
- Subtle text: `#64748b`

Logo / company info source: `BACKEND_URL/static/bvc24-logo.png` and the address constants embedded in the print templates.

---

End of module documentation.

Next: [API Reference — Authentication](../api/01-auth.md)
