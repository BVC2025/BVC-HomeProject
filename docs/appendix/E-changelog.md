# Appendix E — Changelog

Phase-wise release notes for the BVC24 ERP. Dates are approximate, reflecting completion order.

## Release 1.0 — Production Ready (current)

### Phase 5 — Sales Orders with Payment-Gated Workflow

- Added `SalesOrder.ADVANCE_DUE_DATE` column with auto-migration entry.
- Introduced new `AWAITING_ADVANCE` status between `DRAFT` and `CONFIRMED`.
- `POST /sales-orders/{id}/confirm` now sets status to `AWAITING_ADVANCE` and dispatches an HTML email with the advance amount and due date.
- `POST /sales-orders/{id}/payment` auto-confirms the SO once `ADVANCE_RECEIVED ≥ required advance`.
- MD WhatsApp alerts at three SO events: awaiting-advance, auto-confirmed, quote-converted.
- Frontend SODetail modal now shows an amber AWAITING_ADVANCE banner with prominent advance amount + due date.
- "Send Advance Request" / "Record Advance Payment" / "Start Production" action buttons keyed off status.
- Added `ADVANCE_AMOUNT` / `DISPATCH_AMOUNT` / `INSTALLATION_AMOUNT` computed fields on the SO detail response.

### Production & BOM

- Work Order Gantt rewritten with **30-day calendar header** at the top.
- **One stage = one working day** scheduling; Sundays are skipped as leave days.
- Per-row stage card shows assignee chip, day allocation, and the date inside the bar — no hover needed.
- Drawer widened to `98vw`; horizontal sizing ensures all 30 day cells fit on a 1366 × 768 screen.
- Auto-assignment **removed**; stages remain unassigned until admin picks.
- Sales-role employees (matched by NAME / OCCUPATION / SKILLS / Department.NAME / Designation.TITLE / Role.ROLE_NAME containing `sales` / `marketing` / `ragul`) are excluded from production stages. Stale assignments are cleared on each Gantt load.
- Day cells display compact numbers `1`…`30` with date and weekday underneath; Sundays tinted red.
- Sticky header on the Gantt drawer — WO number, product name, units stay visible while scrolling the stage rows.

### Modal Pattern (cross-cutting)

- Applied **sticky-header modal pattern** across:
  - Employee profile (ResumeModal)
  - Quotation detail (ModalShell)
  - Sales Order detail (ModalShell)
  - Purchase Order detail (ModalShell)
  - Work Order Gantt drawer
- Pattern: outer flex column with `maxHeight: 92vh`, header `flexShrink: 0`, body `overflowY: auto, flex: 1, minHeight: 0`.

### WhatsApp Notifications

- New `services/whatsapp_service.py` with two transports:
  - **CallMeBot first** (free, requires API key + WhatsApp join message).
  - **WhatsApp Business Cloud API fallback** (Meta).
- `notify_md_safe()` fire-and-forget wrapper — never blocks parent operation.
- `GET /whatsapp/diagnose` and `POST /whatsapp/test` endpoints.
- Wired into customer enquiry, customer create, quotation-to-SO conversion, SO confirm, SO auto-confirm.

### Inventory

- Rebuilt Inventory page with BVC red theme.
- KPI tiles: Total Materials, Total Stock Value, Low Stock, Out of Stock.
- MaterialCard with stock fill bar.
- AdjustModal for receipt / issue / count adjustments with reason.
- DetailDrawer with stock movement history.
- Category auto-detection from material name (`🪙 Sheet Metal`, `🧊 Refrigeration`, etc.).
- `GET /inventory/full`, `POST /inventory/{id}/adjust`, `GET /inventory/{id}/movements`.

### BVC Red Theme

- Replaced indigo / purple / cyan gradients with the BVC red palette across the entire frontend.
- Login background, sidebar gradients, sidebar accent line, login button, active tab, welcome card, chatbot user bubble — all use `#C8102E`, `#8B0B1F`, `#4A0E18`, `#1A0508`, `#F4B324`.

### Chatbot

- Created `gemini_service.py` for general ERP chatbot via Google Gemini.
- Created `hr_assistant.py` — stateless rule-based bot for leave application.
- Both bots have configured / fallback modes (graceful degradation).

## Release 0.4 — Procurement (Phase 4)

- Supplier master with categories, payment terms, status (ACTIVE / INACTIVE / BLACKLISTED).
- Purchase Order CRUD with line items, header workflow (DRAFT → SENT → CONFIRMED → PARTIAL_RECEIVED → RECEIVED).
- GRN with partial receipts and per-line rejection.
- GRN finalisation pushes stock to Inventory.
- Auto-PO from Project BOM — `POST /purchase-orders/auto-from-project` groups by supplier and creates one PO per supplier.
- PO email to supplier on send; rejection notice resend on GRN.

## Release 0.3 — CRM & Quotations (Phase 3)

- Customer master with lead pipeline (`NEW → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED_WON / CLOSED_LOST`).
- CustomerContact, CustomerRequirement entities.
- Quotation CRUD with lines, totals, terms.
- Quotation workflow: DRAFT → SENT → APPROVED / REJECTED → CONVERTED.
- Public share token (`/q/:token`) — customer-facing view + Approve/Reject response.
- Email dispatch on SEND, view telemetry.
- Auto-pricing from BOM (`POST /quotations/from-requirements`, `GET /quotations/auto-price`).
- A4 print layout.

## Release 0.2 — HR Operations (Phase 2)

- Attendance with biometric integration (BiometricEvent → Attendance pipeline).
- Daily check-in / check-out, status computed against shift start.
- Leave management with token-based email approval (one-click approve / reject).
- Leave types CASUAL / SICK / EARNED (quota-backed) + UNPAID / LOP.
- Payroll runs (monthly) auto-computed from attendance + completed tasks.
- STAR Performance — monthly star ratings with weighted formula, promotion / increment recommendations.
- MD Review screen.

## Release 0.1 — Foundation (Phase 1)

- Vendor / multi-tenancy model.
- Organization preset (`MANUFACTURING`): departments, designations, roles, permissions.
- Employee master (UUID-PK), profile self-registration gate, photo upload.
- JWT-based auth with admin and employee login.
- bcrypt password hashing.
- Auto-migration framework in `main.py`.

## Pre-release / Internal

- Project category + sub-project templates.
- Project + Task entities with status tracking.
- TaskAssignment with approval workflow.
- DailyAllocation pattern for AI workload distribution.
- Notification table + bell UI.
- Email service with Resend + SMTP support.

---

For planned future work see [Appendix D — Roadmap](./D-roadmap.md).
