# 02 — System Architecture

## 2.1 High-Level View

BVC24 follows a conventional **three-tier web application architecture** with a clean separation between presentation, business logic, and persistence.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
│                                                                     │
│   React 19 + Vite SPA                                               │
│   • Role-based routing (admin vs employee landing)                  │
│   • Axios client → JWT in Authorization header                      │
│   • Real-time polling (10s dashboard, 15s tasks)                    │
│   • Recharts for visualisations                                     │
│   • Print views render to A4 PDF via browser print                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  HTTPS / JSON
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  APPLICATION TIER (FastAPI)                         │
│                                                                     │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────────────┐   │
│  │  Routers   │→ │   Services   │→ │   SQLAlchemy ORM (models)  │   │
│  │ (34 files) │  │  (16 files)  │  │      ↕                     │   │
│  └────────────┘  └──────────────┘  │  Auto-migration on startup │   │
│         ▲                          └────────────────────────────┘   │
│         │                                                           │
│  ┌──────┴───────┐  ┌──────────────┐  ┌────────────────────────┐     │
│  │  Schemas     │  │   Auth /     │  │   Integrations         │     │
│  │  (Pydantic)  │  │   JWT        │  │   • Resend / SMTP      │     │
│  └──────────────┘  └──────────────┘  │   • WhatsApp / CallMeBot│    │
│                                      │   • Gemini             │     │
│                                      │   • Biometric devices  │     │
│                                      └────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  SQLAlchemy
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA TIER                                   │
│                                                                     │
│   MySQL 8.x                                                         │
│   • 50+ tables, all with VENDOR_ID for multi-tenancy                │
│   • Activity tables for soft audit trails                           │
│   • File uploads stored on disk in static/ (mounted by FastAPI)     │
└─────────────────────────────────────────────────────────────────────┘
```

## 2.2 Backend Layered Structure

```
backend/
└── app/
    ├── main.py                  ← FastAPI app, CORS, router registration,
    │                              auto-migration on startup
    ├── database/
    │   └── database.py          ← engine, SessionLocal, get_db dependency
    ├── auth/
    │   ├── auth_bearer.py       ← JWT bearer dependency
    │   └── jwt_handler.py       ← encode / decode / refresh
    ├── models/
    │   └── models.py            ← All SQLAlchemy ORM models (single file)
    ├── schemas/                 ← Pydantic request/response schemas
    │   ├── auth_schema.py
    │   ├── sales_order_schema.py
    │   └── ... (22 files)
    ├── routes/                  ← HTTP endpoint routers (34 files)
    │   ├── auth.py
    │   ├── sales_order.py
    │   ├── purchase_order.py
    │   ├── production.py
    │   ├── process.py           ← Gantt + work-order stage progress
    │   ├── quality.py
    │   ├── chatbot.py
    │   ├── whatsapp.py
    │   └── ... (full list in API reference)
    └── services/                ← reusable business logic
        ├── email_service.py     ← Resend or SMTP
        ├── whatsapp_service.py  ← CallMeBot + WhatsApp Cloud API
        ├── auth_service.py      ← bcrypt + JWT payload
        ├── allocation_service.py ← daily task allocation
        ├── workload_service.py  ← least-loaded picker
        ├── payroll_service.py
        ├── performance_service.py
        ├── project_from_product_service.py  ← spawn project from BOM
        ├── leave_service.py
        ├── approval_service.py  ← token-based email/SMS approvals
        ├── gemini_service.py    ← Google Gemini for chatbot
        └── ... (16 files)
```

### Routers, services, models — what goes where

- **Routers** validate inputs, call services or query the DB, and shape the JSON response. They contain HTTP concerns (status codes, headers, query params) but no business decisions.
- **Services** encapsulate cross-cutting business logic — pricing a quote from BOM, picking the least-loaded employee for a task, dispatching email and gracefully falling back from Resend to SMTP, computing a payroll slip.
- **Models** are the single SQLAlchemy module describing every table. There is no separate "domain" layer — the ORM model serves both persistence and business identity.
- **Schemas** are Pydantic v2 classes used for request validation and response serialisation. Each major router has a paired `*_schema.py`.

## 2.3 Frontend Layered Structure

```
frontend/
├── public/
│   └── (static assets)
├── src/
│   ├── main.jsx                 ← React mount + BrowserRouter
│   ├── App.jsx                  ← Routes, role-based landing
│   ├── App.css                  ← Global theme (BVC red palette)
│   ├── services/
│   │   └── api.js               ← Axios instance, JWT injection, 401 handler
│   ├── pages/                   ← Route-level screens (35 files)
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── EmployeeDashboard.jsx
│   │   ├── DashboardHome.jsx
│   │   ├── Customers.jsx
│   │   ├── Quotations.jsx
│   │   ├── SalesOrders.jsx
│   │   ├── PurchaseOrders.jsx
│   │   ├── Production.jsx
│   │   ├── Inventory.jsx
│   │   └── ... (35 total)
│   └── components/              ← reusable UI fragments
│       ├── ChatBot.jsx
│       ├── HRAssistant.jsx
│       ├── EntityDrawer.jsx
│       ├── IconButton.jsx
│       └── TablePagination.jsx
```

### Frontend conventions

- **No external UI library** — the entire UI is custom CSS-in-JS using inline styles and a small set of CSS classes in `App.css`. This keeps the bundle small and visual tweaks predictable.
- **BVC red palette** — primary `#C8102E`, dark `#8B0B1F`, wine `#4A0E18`, wine-black `#1A0508`, gold `#F4B324`. Gradients are `linear-gradient(135deg, #C8102E, #8B0B1F)`.
- **Modal pattern** — every major detail modal uses a *sticky header* layout: outer flex column with `maxHeight: 92vh`, header with `flexShrink: 0`, body with `overflowY: auto, flex: 1, minHeight: 0`. This pattern is repeated across Quotation, Sales Order, Purchase Order, Employee profile, and Work Order Gantt drawer.
- **Real-time polling** — Dashboard refreshes every 10 seconds; employee task list every 15 seconds. No WebSocket layer is used in the current release.

## 2.4 Multi-tenancy

Every customer-facing table carries a `VENDOR_ID` column referencing `vendor.ID`. Currently the system runs single-tenant for BVC (VENDOR_ID = 1) but the model is in place to host additional tenants without schema changes.

- **Cross-tenant queries are prevented at the route layer** — `vendor_id` is taken from the JWT claim and applied as a filter in every list endpoint.
- **Seed data** (`/seed-bvc24`, `/seed-org`, `/seed-materials`) creates a `vendor` row first and links all subsequent rows to it.

## 2.5 Data Flow — Worked Example

**Scenario**: customer Apollo Hospitals enquires for 2 vending machines.

```
1. SALES ENTERS ENQUIRY
   POST /create-customer       → Customer row, LEAD_STATUS=NEW
   POST /customers/enquiry     → fires WhatsApp MD alert via whatsapp_service
   POST /customers/{id}/requirements
                               → CustomerRequirement row

2. QUOTATION
   POST /quotations/from-requirements
                               → Quotation header + lines, auto-priced from BOM
                                 + project_from_product_service heuristic
   POST /quotations/{id}/send  → Quotation.STATUS=SENT
                               → email_service dispatches HTML quote
                                 + PUBLIC_TOKEN created for /q/:token link

3. CUSTOMER APPROVES (public link, no login required)
   GET  /q/{token}             → HTML view
   POST /q/{token}/respond     → QuotationActivity row
                                 + Quotation.STATUS=APPROVED

4. CONVERT TO SALES ORDER
   POST /sales-orders/from-quotation
                               → SalesOrder DRAFT + lines copied
                               + Quotation.STATUS=CONVERTED

5. SEND ADVANCE PAYMENT REQUEST
   POST /sales-orders/{id}/confirm
                               → SO.STATUS=AWAITING_ADVANCE
                               + email_service: HTML email with
                                 advance amount + due date
                               + whatsapp_service: MD alert

6. RECORD ADVANCE PAYMENT
   POST /sales-orders/{id}/payment   (MILESTONE=ADVANCE)
                               → SO.ADVANCE_RECEIVED += amount
                               → if >= required advance:
                                  SO.STATUS=CONFIRMED (automatic)
                                + MD WhatsApp alert

7. START PRODUCTION (spawns Projects)
   POST /sales-orders/{id}/start-production
                               → for each SO line with PRODUCT_MODEL_ID:
                                  project_from_product_service.create_project_from_product()
                               → Project row + child Tasks from process stages
                               → WorkOrder rows + WorkOrderStageProgress
                               → SO.STATUS=IN_PRODUCTION

8. PRODUCTION FLOOR
   PATCH /process/wo/{wo}/stages/{stage}  (one PATCH per stage completion)
                               → WorkOrderStageProgress.STATUS=DONE
                                + STARTED_AT / COMPLETED_AT timestamps

9. QUALITY GATE
   POST /quality/inspections                 (one inspection per WO)
   PATCH /quality/results/{id}               (per checklist item)
   POST /quality/inspections/{id}/finalise   → required before WO.DONE
                               If any FAIL: NCR auto-created

10. SHIP & DELIVER & CLOSE
    POST /sales-orders/{id}/ship    → SO.STATUS=SHIPPED
    POST /sales-orders/{id}/deliver → SO.STATUS=DELIVERED
    POST /sales-orders/{id}/payment (MILESTONE=DISPATCH, then INSTALLATION)
    POST /sales-orders/{id}/close   → SO.STATUS=CLOSED
```

Every transition above writes to a `*_activity` table for audit. The MD receives WhatsApp alerts at the high-value events (enquiry, advance received, full confirmation).

## 2.6 Integration Map

| Integration | Direction | Service | Used For |
|---|---|---|---|
| Resend / SMTP | Outbound | `email_service.py` | Quotation/SO/PO/GRN emails, leave approval links, alerts |
| WhatsApp Business API | Outbound | `whatsapp_service.py` | MD alerts on revenue events |
| CallMeBot | Outbound | `whatsapp_service.py` | Free WhatsApp fallback if Cloud API not configured |
| Google Gemini | Outbound | `gemini_service.py` | General-purpose ERP chatbot |
| Biometric devices (ZKTeco / eSSL) | Inbound | `biometric.py` | `BiometricEvent` rows → resolve to `Employee.FINGERPRINT_ID` → Attendance |
| Browser Print API | Client-side | print views | A4 PDF generation via Chrome / Edge print-to-PDF |

## 2.7 Stateless Backend, Stateful Database

The FastAPI process is stateless — no in-memory session, no in-process cache that affects correctness. This makes it safe to:

- Restart the backend at any time (in-flight HTTP requests will retry from the client).
- Run multiple worker processes behind a reverse proxy (Nginx → Uvicorn workers).
- Replace any instance during deployment without coordination.

The auto-migration block in `main.py` is **idempotent** — it issues `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `DROP INDEX IF EXISTS` for every schema evolution since v0. Restarting the backend after a code update is safe even if a column has not been added by hand.

## 2.8 Performance Profile

The current production target is a single BVC tenant with:

- ~50 employees
- ~200 customers
- ~500 quotations / year
- ~300 sales orders / year
- ~2,000 tasks / month
- ~100 work orders / month

This load is comfortably handled by a single 4 vCPU / 8 GB RAM VM running MySQL + Uvicorn + Vite-built React static bundle. The data tier is the bottleneck — indices on `VENDOR_ID`, `CUSTOMER_ID`, `SO_NUMBER`, `STATUS`, and date columns are in place at the model level.

For future tenants or 10× load:
- MySQL → read replica for analytics queries.
- Uvicorn → 4 workers behind Nginx.
- Static frontend → CDN (CloudFront / Cloudflare).
- Background jobs (large emails, batch reports) → move to a Celery + Redis worker.

---

Next: [03 — Technology Stack](./03-tech-stack.md)
