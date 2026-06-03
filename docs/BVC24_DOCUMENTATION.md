# BVC24 ERP — Complete System Documentation

**Project**: BVC24 — Vendor-based Manufacturing ERP
**Customer**: Bharath Vending Corporation (BVC)
**Edition**: 1.0 — Production Ready
**Document Class**: Engineering & Implementation Reference
**Format**: Master single-file edition

---

## How to Read This Document

This is the master single-file edition of the BVC24 documentation. It is suitable for:

- Sending as a single PDF to a customer or stakeholder.
- Printing to A4 for offline review.
- Hand-off to a CTO, architect, or development team during a transition.

Each section corresponds to a focused file in the multi-file `docs/` tree — see `docs/README.md` for that structured navigation. Cross-references between sections inside this master file use anchor links.

---

# Part I — Foundation

## 1. Executive Summary

### 1.1 Product Identity

**BVC24** is a vendor-based manufacturing ERP designed for **Bharath Vending Corporation (BVC)** — a Chennai-headquartered manufacturer of automated vending machines (snack, beverage, combo, medicine, and special-purpose dispensers).

The platform consolidates the day-to-day operations of a manufacturing-and-installation business into a single web application:

- **Sales** — enquiries, quotations, sales orders, payment milestones.
- **Production** — product catalog, bill of materials, work orders, process stages, Gantt scheduling, quality inspections.
- **Procurement** — supplier master, purchase orders, goods receipt notes, inventory updates.
- **People** — employees, attendance (biometric), leave with email-token approvals, payroll, monthly STAR performance ratings.
- **Customer Lifecycle** — 360° customer view, requirements pipeline, post-sale installation projects.
- **Operations** — daily task allocation, real-time dashboards, MD-level WhatsApp alerts.

### 1.2 Business Value Proposition

BVC24 replaces a patchwork of spreadsheets, WhatsApp chats, and paper trails with a single source of truth that follows the cash flow:

```
Enquiry → Quotation → Sales Order → Advance Payment → Production →
Quality Inspection → Shipping → Installation → Final Payment → AMC
```

Every state transition is timestamped, logged in an activity timeline, and gated by a business rule:

- A **Sales Order cannot enter production** until the customer's advance payment is recorded.
- A **Work Order cannot be closed** until its QC inspection is finalised.
- A **GRN feeds inventory only after finalisation** — preventing accidental stock changes.
- **Leave requests issue a single email** with one-click tokens to the approver — no portal login required.

These guard rails turn process discipline into a property of the software, not human memory.

### 1.3 Stakeholder Map

| Stakeholder | Primary Screens | Key Outcomes |
|---|---|---|
| Managing Director | MD Review, Dashboard, WhatsApp alerts | Cash-in events, top performers, blocked SOs |
| Sales Team | CRM, Quotations, Sales Orders | Quote → SO conversion, payment progress |
| Production Head | Production, Work Orders, Gantt | Stage progress, employee allocation |
| Procurement | Purchase Orders, Suppliers, Inventory | PO funnel, GRN, supplier performance |
| Quality | Quality Management, NCRs | Inspection pass-rate, rework |
| HR | Employees, Attendance, Leave, Payroll | Compliance, payouts, recognitions |
| Floor Employees | Employee Dashboard, Apply Leave, Biometric | Today's tasks, leave balance |
| Customer (external) | Public Quotation link `/q/:token` | View & respond without an account |

### 1.4 Scope of Implementation

**Implemented and live (Release 1.0)**:

- ✅ Phase 1 — Organization, IAM, Employees (profile, biometric, photos)
- ✅ Phase 2 — Attendance, Leave (email-token approval), Payroll, STAR Performance
- ✅ Phase 3 — CRM, Quotations with public share token, auto-pricing from BOM
- ✅ Phase 4 — Procurement (Suppliers, POs, GRN with partial-receipt support)
- ✅ Phase 5 — Sales Orders with payment-gated workflow, auto-project spawning
- ✅ Production — Models, BOM, Work Orders, Process Stages, Gantt
- ✅ Quality — Inspection checklists, NCRs, finalisation gate
- ✅ Machines — Auto-registered from Work Order completion
- ✅ Dashboard & Analytics — real-time stats, voice alerts
- ✅ Notifications — Email (Resend + SMTP), WhatsApp (CallMeBot + Cloud API), in-app, voice
- ✅ Chatbot — HR Assistant (rule-based), general ERP chatbot (Gemini)

**Planned (not in this release)**:

- ⏳ Phase 6 — Invoicing, GST e-Invoice, e-Way Bill
- ⏳ Phase 7 — Service / AMC, complaint tickets

### 1.5 Headline Metrics

| Surface | Count |
|---|---|
| Backend route files | 34 |
| HTTP endpoints | ~200 |
| Frontend pages | 35 |
| Print views | 4 |
| Public (no-auth) routes | 2 |
| Database tables | 50+ |
| Third-party integrations | 5 (Resend, SMTP, Gemini, CallMeBot, WhatsApp) |

---

## 2. System Architecture

### 2.1 High-Level View

A standard three-tier web application:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
│   React 19 + Vite SPA · role-based routing · Axios + JWT            │
│   Real-time polling (10s dashboard, 15s tasks) · Recharts           │
│   Print views render to A4 PDF via browser print                    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  HTTPS / JSON
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  APPLICATION TIER (FastAPI)                         │
│  Routers (34) → Services (16) → SQLAlchemy ORM ↔ Auto-migration     │
│  JWT auth · Pydantic schemas · Integrations: Resend, WhatsApp,      │
│  Gemini, Biometric                                                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  SQLAlchemy
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA TIER                                   │
│   MySQL 8.x · 50+ tables, all multi-tenant (VENDOR_ID)              │
│   Activity tables for audit · file uploads on disk (static/)        │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Backend Layered Structure

```
backend/app/
├── main.py                  ← FastAPI app, CORS, router registration,
│                              auto-migration on startup
├── database/database.py     ← engine, SessionLocal, get_db
├── auth/                    ← JWT bearer + encode/decode
├── models/models.py         ← All SQLAlchemy ORM models
├── schemas/                 ← Pydantic schemas (22 files)
├── routes/                  ← HTTP endpoint routers (34 files)
└── services/                ← business logic (16 files)
```

- **Routers** validate inputs, call services or the DB, shape the JSON response.
- **Services** encapsulate cross-cutting business logic (pricing, email, WhatsApp, payroll computation).
- **Models** describe every table; the same ORM class serves both persistence and business identity.
- **Schemas** are Pydantic v2 classes used for request validation and response serialisation.

### 2.3 Frontend Layered Structure

```
frontend/src/
├── main.jsx                 ← React mount + BrowserRouter
├── App.jsx                  ← Routes, role-based landing
├── App.css                  ← Global theme (BVC red palette)
├── services/api.js          ← Axios instance, JWT injection
├── pages/                   ← 35 screens
└── components/              ← shared UI (ChatBot, HRAssistant, EntityDrawer, etc.)
```

- **No external UI library** — all UI is custom CSS-in-JS with inline styles + a small CSS file.
- **BVC red palette**: `#C8102E` primary, `#8B0B1F` dark, `#4A0E18` wine, `#1A0508` wine-black, `#F4B324` gold.
- **Sticky-header modal pattern** is reused across every detail modal in the system.
- **Real-time polling** every 10s (dashboard) / 15s (tasks). No WebSockets in this release.

### 2.4 Multi-tenancy

Every customer-facing table carries a `VENDOR_ID` referencing `vendor.ID`. The JWT carries `vendor_id` from login; every list query filters by it. Cross-tenant access is impossible without forging the token.

Currently BVC operates as `VENDOR_ID = 1`. Onboarding additional tenants requires no schema changes.

### 2.5 Worked Example — Sale to Shipment

```
1. Customer Apollo Hospitals enquires
   POST /create-customer            → Customer (LEAD_STATUS=NEW)
   POST /customers/enquiry          → WhatsApp MD alert
   POST /customers/{id}/requirements

2. Quotation
   POST /quotations/from-requirements → auto-priced from BOM
   POST /quotations/{id}/send        → STATUS=SENT, email + public token

3. Customer approves (no portal login)
   GET  /q/{token}                   → HTML view
   POST /q/{token}/respond           → STATUS=APPROVED

4. Convert to Sales Order
   POST /sales-orders/from-quotation → SO DRAFT

5. Send advance request
   POST /sales-orders/{id}/confirm   → STATUS=AWAITING_ADVANCE
                                      → Email with advance amount + due date
                                      → MD WhatsApp alert

6. Customer pays advance
   POST /sales-orders/{id}/payment   → ADVANCE_RECEIVED += amount
                                      → Auto-confirm when ≥ required advance
                                      → MD WhatsApp alert

7. Start production
   POST /sales-orders/{id}/start-production
                                     → Projects spawned per line
                                     → Work Orders created
                                     → STATUS=IN_PRODUCTION

8. Production floor
   PATCH /process/wo/{wo}/stages/{stage}  per stage completion

9. QC gate
   POST /quality/inspections + finalise → blocks WO DONE until passed

10. Ship → Deliver → Close
```

### 2.6 Integration Map

| Integration | Direction | Used For |
|---|---|---|
| Resend / SMTP | Outbound | All transactional emails |
| WhatsApp Business API | Outbound | MD revenue-event alerts |
| CallMeBot | Outbound | Free WhatsApp fallback |
| Google Gemini | Outbound | General ERP chatbot |
| Biometric devices | Inbound | Attendance from raw scans |
| Browser Print API | Client | A4 PDF generation |

### 2.7 Stateless Backend

The FastAPI process is stateless — restartable at any time, horizontally scalable behind Nginx. The auto-migration block is idempotent (`IF NOT EXISTS`) so deployments don't need separate schema scripts.

---

## 3. Technology Stack

### 3.1 Backend

| Layer | Technology | Version |
|---|---|---|
| Language | Python | 3.13 |
| Web framework | FastAPI | latest |
| ASGI server | Uvicorn | latest |
| ORM | SQLAlchemy | 2.x |
| DB driver | PyMySQL | latest |
| Validation | Pydantic | v2 |
| Password hashing | bcrypt (`passlib`) | latest |
| JWT | `python-jose` | latest |
| Email | Resend HTTP API / SMTP | — |
| WhatsApp | Cloud API + CallMeBot | v22.0 |
| Chat | Google Gemini | v1 |

### 3.2 Frontend

| Dependency | Version | Purpose |
|---|---|---|
| React | ^19.2.6 | UI |
| React DOM | ^19.2.6 | rendering |
| React Router DOM | ^7.15.0 | routing |
| Axios | ^1.16.0 | HTTP |
| Recharts | ^3.8.1 | charts |
| Vite | latest | bundler |

No external UI library, no Tailwind. The visual layer is custom CSS-in-JS with BVC red. Bundle size ~250 KB gzipped.

### 3.3 Database

- **MySQL 8.x**, `utf8mb4`, `utf8mb4_unicode_ci`.
- 50+ tables, all with `VENDOR_ID`.
- Indices on every `*_ID` foreign key and commonly filtered status columns.
- Auto-migration on backend startup (idempotent `ALTER TABLE ... IF NOT EXISTS`).

### 3.4 Third-Party Services

| Service | Required | Notes |
|---|---|---|
| Resend or SMTP | One required | Email transport |
| WhatsApp Cloud API / CallMeBot | Optional | MD alerts |
| Google Gemini | Optional | General chatbot |
| Biometric device | Optional | Attendance |

All optional services degrade gracefully — missing config never blocks a business operation.

---

## 4. Installation & Deployment

### 4.1 Prerequisites

| Software | Min. version |
|---|---|
| Python | 3.11+ (3.13 recommended) |
| Node.js | 20 LTS |
| MySQL | 8.0+ |
| Git | any |

### 4.2 Local Development

```bash
# 1. Clone
git clone <repo> bvc24-erp && cd bvc24-erp

# 2. Database
mysql -u root -p <<EOF
CREATE DATABASE bvc24 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'bvc24'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL ON bvc24.* TO 'bvc24'@'localhost';
EOF

# 3. Backend
cd backend
python -m venv venv && venv/Scripts/activate
pip install -r requirements.txt
# Create .env per Appendix C
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 4. Seed
# Visit http://127.0.0.1:8001/docs and POST:
#   /seed-org, /seed-admin, /seed-employees, /seed-bvc24,
#   /seed-materials, /seed-project-templates

# 5. Frontend
cd ../frontend
npm install
npm run dev      # → http://localhost:5173
```

### 4.3 Production Deployment

Single-VM topology (4 vCPU / 8 GB RAM) is sufficient for the current scale.

```
                     Internet
                        │
                    ┌───┴────┐
                    │ Nginx  │  TLS via Certbot
                    └───┬────┘
              ┌─────────┴───────────┐
        ┌─────┴───────┐      ┌──────┴─────┐
        │/api/* → 8001│      │/ → dist/   │
        │(Uvicorn × 2)│      │(static)    │
        └─────┬───────┘      └────────────┘
              │
        ┌─────┴───────┐
        │   MySQL     │
        └─────────────┘
```

### 4.4 Systemd unit (backend)

```ini
[Unit]
Description=BVC24 Backend
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/bvc24-erp/backend
ExecStart=/opt/bvc24-erp/backend/venv/bin/uvicorn app.main:app \
          --host 127.0.0.1 --port 8001 --workers 2
Restart=always

[Install]
WantedBy=multi-user.target
```

### 4.5 Nginx (frontend + API proxy)

```nginx
server {
    listen 80;
    server_name erp.bvc24.in;

    root /opt/bvc24-erp/frontend/dist;
    index index.html;
    try_files $uri /index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static/ {
        proxy_pass http://127.0.0.1:8001/static/;
    }
}
```

### 4.6 Upgrade Procedure

```bash
cd /opt/bvc24-erp
git pull origin main
cd backend && venv/bin/pip install -r requirements.txt
cd ../frontend && npm ci && npm run build
sudo systemctl restart bvc24-backend
```

Auto-migration applies any new schema changes idempotently on startup.

### 4.7 Backups

Daily mysqldump + tarball of `backend/app/static/`. Retain 30 days + 1 monthly archive.

### 4.8 Required Environment Variables (minimal)

```env
MY_SQL=localhost:3306
DB_NAME=bvc24
SECRET_KEY=<random 32+ char>
RESEND_API_KEY=re_...           # OR SMTP_HOST/PORT/USER/PASSWORD
SMTP_FROM=erp@bvc24.in
APPROVER_EMAIL=md@bvc24.in
FRONTEND_URL=https://erp.bvc24.in
BACKEND_URL=https://erp.bvc24.in/api
```

See Appendix C for the complete env-var reference.

---

## 5. Security & Authentication

### 5.1 Auth Model

JWT-based stateless authentication with two login flows:

| Role | Endpoint | Identity |
|---|---|---|
| Admin / MD / HR / Production Head | `POST /admin-login` | `EMAIL` + password |
| Floor Employee | `POST /employee-login` | `EMPLOYEE_CODE` + password |

Tokens signed with `SECRET_KEY` (HS256). Default expiry 7 days. 401 → client clears `localStorage` and redirects to `/login`.

### 5.2 Password Storage

bcrypt via `passlib`, cost 12. No plaintext stored. `PUT /employees/{id}/reset-password` lets admin reset.

### 5.3 Role-Based Access Control

Seeded system roles: `SUPER_ADMIN`, `ADMIN`, `HR`, `MANAGER`, `PRODUCTION_HEAD`, `SALES`, `EMPLOYEE`.

Permission codes (`task.assign`, `report.export`, etc.) are defined and stored, with role-level enforcement at routes today. Per-permission decorators are on the roadmap.

### 5.4 Multi-tenancy

Every customer-facing table includes `VENDOR_ID`. JWT carries `vendor_id`. Every list query filters by it. No shared data between tenants.

### 5.5 Public Endpoints (No Authentication)

| Endpoint | Auth |
|---|---|
| `POST /admin-login`, `/login`, `/employee-login` | Credentials |
| `GET /q/{token}` | Token in URL (quotation public view) |
| `POST /q/{token}/respond` | Token in URL |
| `GET /approve-task?token=...` | Token in URL |
| `GET /reject-task?token=...` | Token in URL |
| `GET /leave/decide/{token}?action=` | Token in URL |
| `POST /biometric/scan` | (device, consider device-token in production) |

Tokens are `secrets.token_urlsafe(24)` — 32 URL-safe characters. Inert after consumption.

### 5.6 Transport & Storage

- TLS via Nginx + Certbot.
- bcrypt password hashing.
- All SQL queries parameterised via SQLAlchemy ORM.
- React escapes output by default.
- CORS configured in `main.py`; restrict `allow_origins` in production.

### 5.7 Audit Trail

Every business-critical entity has an `*_activity` companion table with `EVENT_TYPE`, `EVENT_DETAIL`, `ACTOR_TYPE` (`SYSTEM` / `SALES` / `CUSTOMER` / `SUPPLIER` / `WAREHOUSE` / `ADMIN`), `ACTOR_NAME`, `CREATED_AT`.

### 5.8 Production Hardening Checklist

- [ ] Set `SECRET_KEY` to a 32+ char random value.
- [ ] Restrict CORS `allow_origins` to production frontend host.
- [ ] Gate seed endpoints behind a production check.
- [ ] Force HTTPS at Nginx.
- [ ] Configure DB backups offsite.
- [ ] Configure log shipping (journal → ELK / CloudWatch).
- [ ] Add rate limiting on login endpoints.

---

## 6. Database Schema

A complete data dictionary follows. Generic columns (`ID`, `CREATED_AT`, `UPDATED_AT`) are omitted unless they carry notable defaults.

### 6.1 Organization & Multi-tenancy

| Model | Table | Notes |
|---|---|---|
| Vendor | `vendor` | Tenant; `VENDOR_NAME` |
| RootUser | `root_user` | Tenant admin; `EMAIL`, `PASSWORD` |
| Department | `department` | `CODE`, `NAME`, `HEAD_EMPLOYEE_ID` |
| Designation | `designation` | `TITLE`, `DEPARTMENT_ID`, `BASE_SALARY` |
| Role | `role` | `ROLE_NAME`, `IS_SYSTEM` |
| Permission | `permission` | `CODE`, `NAME` |
| RolePermission | `role_permission` | M2M role↔permission |

### 6.2 People

**Employee** (`employee`) — primary fields: `EMPLOYEE_CODE` (unique), `NAME`, `EMAIL`, `PHONE`, `PASSWORD` (bcrypt), `DEPARTMENT_ID`, `DESIGNATION_ID`, `ROLE_ID`, `REPORTING_MANAGER_ID` (self-FK), `JOINING_DATE`, `SALARY`, `SHIFT_START`/`END`, `STATUS` (ACTIVE/SUSPENDED/RESIGNED/TERMINATED), `FINGERPRINT_ID`, `PROFILE_SUBMITTED`, `SKILLS`. Profile: `ADDRESS`, `CITY`, `STATE`, `PINCODE`, `DOB`, `GENDER`, `FATHER_NAME`, `MOTHER_NAME`, `MARITAL_STATUS`, `OCCUPATION`, `QUALIFICATION`, `YEAR_OF_PASSING`, `EXPERIENCE_YEARS`, `EXPERIENCE_DETAILS`, `PAST_PROJECTS`, `EMPLOYMENT_TYPE`, `PHOTO_URL`. `VENDOR_ID`.

**Customer** (`customer`): `CUSTOMER_CODE`, `CUSTOMER_NAME`, `CONTACT_PERSON`, `PHONE`, `EMAIL`, `GST_NUMBER`, `INDUSTRY`, `STATUS` (LEAD/PROSPECT/ACTIVE/INACTIVE), `LEAD_STATUS` (NEW/QUALIFIED/PROPOSAL/NEGOTIATION/CLOSED_WON/CLOSED_LOST), `LEAD_SOURCE`, `LEAD_PRIORITY`, `ASSIGNED_SALES_ID`, qualification fields (`NUMBER_OF_BRANCHES`, `EXPECTED_MONTHLY_ORDERS`, `EXISTING_MACHINE_USAGE`, `CURRENT_VENDOR_NAME`), `BILLING_ADDRESS`, `SHIPPING_ADDRESS`, `WHATSAPP_NUMBER`.

**Supplier** (`supplier`): `SUPPLIER_CODE`, `COMPANY_NAME`, `CONTACT_PERSON`, `PHONE`, `EMAIL`, `GST_NUMBER`, `CATEGORY`, `PAYMENT_TERMS`, `STATUS` (ACTIVE/INACTIVE/BLACKLISTED).

### 6.3 Sales

**Quotation** (`quotation`): `QUOTATION_NUMBER` (unique), `CUSTOMER_ID`, `QUOTATION_DATE`, `VALIDITY_DAYS`, `EXPIRY_DATE`, `STATUS` (DRAFT/SENT/APPROVED/REJECTED/CONVERTED/EXPIRED), totals (`SUBTOTAL`, `DISCOUNT_PERCENT`, `TAX_PERCENT`, `GRAND_TOTAL`), `PREPARED_BY`, `PUBLIC_TOKEN`, `EMAIL_SENT_AT`, `VIEWED_AT`, `VIEW_COUNT`.

**QuotationLine** (`quotation_line`): `QUOTATION_ID`, `PRODUCT_MODEL_ID`, `REQUIREMENT_ID`, `DESCRIPTION`, `HSN_CODE`, `QUANTITY`, `UNIT`, `UNIT_PRICE`, `DISCOUNT_PERCENT`, `LINE_TOTAL`.

**QuotationActivity** (`quotation_activity`): audit timeline.

**SalesOrder** (`sales_order`): `SO_NUMBER` (unique), `CUSTOMER_ID`, `QUOTATION_ID`, `SO_DATE`, `EXPECTED_DELIVERY_DATE`, **`ADVANCE_DUE_DATE`** (Phase 5), `STATUS` (DRAFT / **AWAITING_ADVANCE** / CONFIRMED / IN_PRODUCTION / SHIPPED / DELIVERED / CLOSED / CANCELLED), totals, `ADVANCE_PERCENT`(50)/`DISPATCH_PERCENT`(40)/`INSTALLATION_PERCENT`(10), `ADVANCE_RECEIVED`/`DISPATCH_RECEIVED`/`INSTALLATION_RECEIVED`, `PREPARED_BY`, `CONFIRMED_AT`, `PRODUCTION_STARTED_AT`, `SHIPPED_AT`, `DELIVERED_AT`, `CLOSED_AT`, `CANCELLED_AT`, `CANCEL_REASON`.

**SalesOrderLine** (`sales_order_line`): `SO_ID`, `PRODUCT_MODEL_ID`, `QUOTATION_LINE_ID`, **`SPAWNED_PROJECT_ID`** (set when production starts), pricing, `LINE_TOTAL`.

**SalesOrderActivity** (`sales_order_activity`): audit timeline.

### 6.4 Purchase

**PurchaseOrder** (`purchase_order`): `PO_NUMBER`, `SUPPLIER_ID`, `PO_DATE`, `EXPECTED_DELIVERY_DATE`, `STATUS` (DRAFT/SENT/CONFIRMED/PARTIAL_RECEIVED/RECEIVED/CANCELLED), totals, `DELIVERY_ADDRESS`, `LINKED_PROJECT_ID`, `PREPARED_BY`.

**PurchaseOrderLine** (`purchase_order_line`): `PO_ID`, `MATERIAL_ID`, `BOM_ITEM_ID`, `QUANTITY`, `QUANTITY_RECEIVED`, pricing.

**GoodsReceiptNote** (`goods_receipt_note`): `GRN_NUMBER`, `PO_ID`, `RECEIVED_DATE`, `RECEIVED_BY`, `STATUS` (DRAFT/FINAL), `INVOICE_NUMBER`.

**GoodsReceiptLine** (`goods_receipt_line`): `GRN_ID`, `PO_LINE_ID`, `QUANTITY_RECEIVED`, `QUANTITY_REJECTED`, `REJECTION_REASON`.

**PurchaseOrderActivity** (`purchase_order_activity`).

### 6.5 Inventory

**MaterialCatalog** (`material_catalog`): master list — `MATERIAL_NAME` unique.

**MaterialDepartment** (`material_department`): M2M material↔department.

**Inventory** (`inventory`): per-vendor stock — `MATERIAL_ID`, `MATERIAL_NAME`, `QUANTITY`, `UNIT_PRICE`.

### 6.6 Production

**ProductModel** (`product_model`): `MODEL_NAME`, `MODEL_CODE`, `CATEGORY`, `ESTIMATED_BUILD_DAYS`, `STATUS`.

**BOMItem** (`bom_item`): `PRODUCT_MODEL_ID`, `MATERIAL_ID`, `MATERIAL_NAME`, `QUANTITY`, `UNIT`, **`ITEM_TYPE`** (PURCHASE/PROCESS), `PREFERRED_SUPPLIER_ID`, `PROCESS_STAGE_ID`, `ITEM_NO`, `IMAGE_URL`.

**ProcessStage** (`process_stage`): `PRODUCT_MODEL_ID`, `SEQUENCE`, `STAGE_NAME`, `STAGE_TYPE` (DESIGN / MECHANICAL / ELECTRICAL / WIRING / FABRICATION / ASSEMBLY / TESTING / QC / PACKAGING / OTHER), `ESTIMATED_HOURS`, `IS_ACTIVE`.

**WorkOrder** (`work_order`): `WO_NUMBER`, `PRODUCT_MODEL_ID`, `PROJECT_ID`, `QUANTITY`, `STATUS` (PLANNED/IN_PROGRESS/ON_HOLD/DONE/CANCELLED), planned + actual dates.

**WorkOrderStageProgress** (`wo_stage_progress`): `WORK_ORDER_ID`, `STAGE_ID`, `STATUS` (PENDING/IN_PROGRESS/DONE/FAILED/SKIPPED), `ASSIGNED_TO_ID`, `STARTED_AT`, `COMPLETED_AT`, `NOTES`.

**Machine** (`machine`): `MACHINE_NAME`, `MACHINE_TYPE`, `STATUS`, `LOCATION`, `PRODUCT_MODEL_ID`, `WORK_ORDER_ID`, `UNIT_NUMBER`, `SERIAL_NO`.

**MachineLog** (`machine_log`): `MACHINE_ID`, `STATUS`, `NOTE`, `TIMESTAMP`.

### 6.7 Quality

**QCChecklistItem** (`qc_checklist_item`): `PRODUCT_MODEL_ID`, `SEQUENCE`, `CHECK_POINT`, `DESCRIPTION`, `SEVERITY` (CRITICAL/MAJOR/MINOR), `IS_ACTIVE`.

**QCInspection** (`qc_inspection`): `WORK_ORDER_ID`, `PRODUCT_MODEL_ID`, `INSPECTOR_ID`, `INSPECTION_DATE`, `STATUS`, counts.

**QCInspectionResult** (`qc_inspection_result`): `INSPECTION_ID`, `CHECKLIST_ITEM_ID`, `CHECK_POINT`, `RESULT` (PASS/FAIL/NEEDS_REWORK/NA), `NOTES`.

**NCR** (`ncr`): auto-created on failure — `NCR_NUMBER`, `INSPECTION_ID`, `WORK_ORDER_ID`, `PRODUCT_MODEL_ID`, `CHECK_POINT`, `SEVERITY`, `DESCRIPTION`, `ROOT_CAUSE`, `CORRECTIVE_ACTION`, `STATUS` (OPEN/IN_PROGRESS/CLOSED), assignees, timestamps.

### 6.8 Projects & Tasks

**ProjectCategory** (`project_category`): `SECTION`, `NAME`.

**SubProjectTemplate** (`sub_project_template`): `CATEGORY_ID`, `NAME`, `ESTIMATED_TOTAL_DAYS`.

**Project** (`project`): `PROJECT_NAME`, `DESCRIPTION`, `STATUS`, `SUB_PROJECT_TEMPLATE_ID`, `DEPARTMENT_ID`, `CUSTOMER_ID`, `PRODUCT_MODEL_ID`, `QUANTITY`, `TARGET_DATE`, `PRIORITY`, `SKILLS_REQUIRED`.

**Task** (`task`): `TASK_NAME`, `STATUS`, `PRIORITY`, `PROJECT_ID`, `ASSIGNED_TO`, `START_TIME`, `END_TIME`.

**TaskAssignment** (`task_assignment`): formal allocation with `APPROVAL_STATUS` (PENDING_APPROVAL/APPROVED/REJECTED/EXPIRED), `APPROVAL_TOKEN`, `ASSIGNED_BY_ID`.

**DailyAllocation** (`daily_allocation`): AI allocator output per employee per day.

### 6.9 Attendance & Leave

**BiometricEvent** (`biometric_event`): raw device scan log.

**Attendance** (`attendance`): daily record — `EMPLOYEE_ID`, `DATE`, `CHECK_IN`, `CHECK_OUT`, `STATUS`, `WORKED_HOURS`, `OVERTIME_HOURS`.

**LeaveRequest** (`leave_request`): `EMPLOYEE_ID`, `LEAVE_TYPE` (CASUAL/SICK/EARNED/UNPAID/LOP), dates, `DAYS`, `REASON`, `STATUS`, `APPROVAL_TOKEN`.

**LeaveBalance** (`leave_balance`): annual quota — Casual 12, Sick 12, Earned 15.

### 6.10 Payroll & Performance

**PayrollRun** (`payroll_run`): header per (vendor, year, month) — `STATUS` (DRAFT/FINALIZED/PAID).

**PayrollSlip** (`payroll_slip`): per-employee breakdown with attendance counts, task bonus, OT, penalties, net pay.

**PerformanceScore** (`performance_score`): monthly STAR rating with weighted formula (25 % attendance + 30 % tasks + 25 % productivity + 20 % consistency), recommendations.

### 6.11 System

**Setting**, **Notification**.

---

# Part II — Functional Modules

## Module 01 — Organization Management

Defines Vendor, Department, Designation, Role, Permission, RolePermission.

**Workflows**:

- Initial setup: `POST /create-vendor` → `POST /seed-org` (MANUFACTURING preset) → `POST /seed-admin`.
- Custom departments / roles / permissions via standard CRUD endpoints.

**System roles seeded**: `SUPER_ADMIN`, `ADMIN`, `HR`, `MANAGER`, `PRODUCTION_HEAD`, `SALES`, `EMPLOYEE` — `IS_SYSTEM=1` prevents deletion.

**Permissions** follow `<entity>.<action>` codes (e.g. `task.assign`). Definitions are seeded; enforcement is currently role-level.

**Multi-tenancy**: every customer-facing table carries `VENDOR_ID`; JWT carries `vendor_id`; queries filter accordingly.

---

## Module 02 — Human Resources

Five sub-modules sharing the `employee` table.

### 2.1 Employee Master

- Directory at `/employees` with photos, skill tags.
- Self-registration flow: admin creates employee → employee logs in → sees `EmployeeProfileForm` → submits → `PROFILE_SUBMITTED=1` locks the form.
- ResumeModal shows full profile with sticky header.

### 2.2 Attendance

- `/biometric` kiosk for fingerprint check-in.
- Device pushes `/biometric/scan` → BiometricEvent → resolved to Attendance via `FINGERPRINT_ID`.
- Status (PRESENT/LATE/ABSENT/HALF_DAY) computed from check-in vs. shift start.

### 2.3 Leave

- Token-based email approval — single click from approver's email.
- LeaveBalance tracks Casual (12), Sick (12), Earned (15) annual quota.
- Casual/Sick auto-convert to LOP when exhausted; Earned rejected.

### 2.4 Payroll

- Auto-computed from attendance + completed tasks + OT.
- Formula: `EARNED_BASIC + TASK_BONUS + OT_PAY - DEDUCTIONS = NET_PAY`.
- TASK_BONUS = completed tasks × 100 (default).
- Runs progress DRAFT → FINALIZED → PAID.

### 2.5 STAR Performance

- Monthly star rating per employee.
- Formula: `0.25 × ATT + 0.30 × TASK + 0.25 × PROD + 0.20 × CONS`.
- `≥ 4.5` → recommended for promotion; `≥ 4.0` → recommended for increment.
- MD approves recommendations via MDReview screen.

---

## Module 03 — CRM

Customer + Contact + Requirement entities. Lead pipeline:

```
NEW → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED_WON / CLOSED_LOST
```

**WhatsApp MD alerts** fire on `POST /create-customer` and `POST /customers/enquiry` with rich context (customer, industry, sales rep, expected orders).

**Convert path**: `POST /customers/{cid}/requirements/{rid}/to-project` skips quotation and spawns a project directly.

Qualification fields (`BUSINESS_TYPE`, `NUMBER_OF_BRANCHES`, `EXPECTED_MONTHLY_ORDERS`, `LEAD_PRIORITY`) help prioritise leads.

---

## Module 04 — Quotations

State machine: `DRAFT → SENT → APPROVED/REJECTED → CONVERTED` (or `EXPIRED`).

**Public link** — `GET /q/{token}` serves a no-auth customer view; `POST /q/{token}/respond` records approval/rejection. Telemetry: `VIEWED_AT`, `VIEW_COUNT`.

**Auto-pricing**: `POST /quotations/from-requirements` builds a quote from BOM with a configurable margin.

**Email**: HTML template with BVC red header, line items, totals, validity warning, CTA to public link. Transport: Resend → SMTP fallback.

**Print**: `/quotation-print/:id` renders A4 layout for browser PDF export.

**Activity timeline** records CREATED, LINE_*, SENT, EMAIL_SENT/FAILED, VIEWED, APPROVED, REJECTED, CONVERTED.

---

## Module 05 — Sales Orders (Phase 5)

The most business-critical module.

### Payment-gated state machine

```
DRAFT ──/confirm──▶ AWAITING_ADVANCE ──advance fully paid──▶ CONFIRMED
                                                                │
                                                                ▼
                                                       (auto on /payment)
CONFIRMED ──/start-production──▶ IN_PRODUCTION ──/ship──▶ SHIPPED
       ──/deliver──▶ DELIVERED ──/close──▶ CLOSED

(any non-CLOSED) ──/cancel──▶ CANCELLED
```

### Three payment milestones (defaults)

- Advance 50 % — before production starts
- On Dispatch 40 % — at shipping
- On Installation 10 % — at site delivery

### Workflow

1. `POST /sales-orders/{id}/confirm` — sets `AWAITING_ADVANCE`, ensures `ADVANCE_DUE_DATE` (defaults SO_DATE + 7 days), emails customer with **highlighted advance amount + due date box**.
2. `POST /sales-orders/{id}/payment` (`MILESTONE=ADVANCE`) — increments `ADVANCE_RECEIVED`. **Auto-flips to CONFIRMED** when ≥ required advance.
3. `POST /sales-orders/{id}/start-production` — invokes `project_from_product_service.create_project_from_product()` for each line, spawning Project + Tasks + Work Order. `SPAWNED_PROJECT_ID` recorded on the SO line.
4. `/ship` → SHIPPED, `/deliver` → DELIVERED, `/close` → CLOSED.

### MD WhatsApp alerts

- `/confirm` → "📩 Sales Order — Awaiting Advance" (SO #, customer, total, advance amount + due).
- `/payment` auto-confirm → "✅ Sales Order CONFIRMED — Advance Received".
- `from-quotation` → "🏆 Quotation CONVERTED to Sales Order".

### UI

- Status pill, action button changes by state.
- Amber AWAITING_ADVANCE banner showing advance ₹ + due date.
- Payment progress card with three milestone tiles.

### Computed fields on `GET /sales-orders/{id}`

`ADVANCE_AMOUNT`, `DISPATCH_AMOUNT`, `INSTALLATION_AMOUNT`, `PAYMENT_RECEIVED_TOTAL`, `PAYMENT_PENDING`, `PAYMENT_PROGRESS_PCT`.

---

## Module 06 — Purchase Orders

State machine: `DRAFT → SENT → CONFIRMED → PARTIAL_RECEIVED → RECEIVED` (or `CANCELLED`).

**GRN workflow**: a single PO may have multiple GRNs (partial deliveries). Each GRN tracks `QUANTITY_RECEIVED` + `QUANTITY_REJECTED` per line. GRN starts as `DRAFT`; **only `FINAL` GRNs push to inventory**.

**Auto-PO from project**: `POST /purchase-orders/auto-from-project` walks the BOM, groups by `PREFERRED_SUPPLIER_ID`, creates one PO per supplier. A 30-item BOM across 5 suppliers becomes 5 POs in one click.

**Rejection notice**: `POST /purchase-orders/grn/{id}/resend-rejection-notice` emails the supplier with itemised rejections + reasons.

**Activity timeline** records the full chain — CREATED, LINE_*, SENT, CONFIRMED, GRN_RECORDED, GRN_FINALIZED, PARTIAL_RECEIVED, RECEIVED, REJECTION_NOTICE_SENT, CANCELLED.

---

## Module 07 — Suppliers

Master record of all external vendors. `STATUS = ACTIVE / INACTIVE / BLACKLISTED`. PO creation validates supplier is `ACTIVE`.

Categories: Sheet Metal, Electronics / PCBs, Refrigeration, Vending Mechanisms, Payment Systems, Display, Packaging, Logistics, Misc.

**360° view** (`/connect/supplier/{id}/360`) aggregates total POs, on-time delivery rate, GRN rejection rate, average order value, last 10 POs.

---

## Module 08 — Inventory

KPI tiles: Total Materials, Total Stock Value, Low Stock, Out of Stock.

**Status buckets**: `OUT_OF_STOCK` (qty ≤ 0), `LOW_STOCK` (qty < reorder), `OK`.

**Category auto-detection** from material name maps to emoji badges (🪙 Sheet Metal, 🧊 Refrigeration, ⚡ Electrical, etc.).

**Stock adjustment** (`POST /inventory/{id}/adjust`) — TYPE = RECEIPT / ISSUE / COUNT. Each adjustment logs a movement.

**Inventory ← GRN pipeline**: only GRN finalisation pushes stock. Drafts don't affect inventory.

**Material → Department scoping**: `/materials/for-me` returns only materials accessible to the current employee's department.

---

## Module 09 — Projects & Tasks

Projects are execution containers between sale and delivered machine.

**Spawning paths**:

1. Primary — `POST /sales-orders/{id}/start-production` via `project_from_product_service`.
2. CRM shortcut — `POST /customers/{cid}/requirements/{rid}/to-project`.
3. Manual — `POST /create-project`.

**Tasks** are the unit of daily work. Lifecycle: `PENDING → IN_PROGRESS → COMPLETED` (or `ON_HOLD`).

**TaskAssignment** adds formal approval workflow:

- `APPROVAL_TOKEN` for one-click email approval / rejection.
- Approver gets `/approve-task?token=...` / `/reject-task?token=...` links.
- Employee then accepts / rejects from their dashboard.

**Workload service** picks the least-loaded employee matching required skills for auto-assignment.

**DailyAllocation** is the AI allocator's output — which employee gets which task on which day.

**Carryover banner** — `pending-from-yesterday` surfaces incomplete tasks the next morning.

---

## Module 10 — Production & BOM

### Product Models

The vending machine catalog: `BVC24 Snack & Beverage Combo (BVC-SBC-01)`, `BVC24 Medicine Dispenser (BVC-MED-01)`, etc.

### BOM (Bill of Materials)

Each line is classified as `ITEM_TYPE`:

- **PURCHASE** — sourced from supplier (feeds auto-PO flow).
- **PROCESS** — made in-house at a specific process stage.

Each line carries `IMAGE_URL` (assembly reference photo).

`POST /production/models/{id}/seed-default-bom` creates a 10-stage flow: Design Review → Mechanical Design → Electrical Design → Sheet Metal Fabrication → Electrical Wiring → Component Assembly → Software Flashing → Bench Testing → Pre-Dispatch QC → Packaging & Dispatch (86h total).

### Process Stages

Colour-coded by `STAGE_TYPE`:

| Type | Colour |
|---|---|
| DESIGN | Purple |
| MECHANICAL | Blue |
| ELECTRICAL | Cyan |
| FABRICATION | Amber |
| ASSEMBLY | Emerald |
| TESTING | Pink |
| QC | Red |
| PACKAGING | Slate |

### Work Orders

State machine: `PLANNED → IN_PROGRESS → DONE` (or `ON_HOLD` / `CANCELLED`). On create, `POST /process/spawn-for-wo/{wo_id}` spawns one `WorkOrderStageProgress` row per active stage.

### Gantt Timeline (`GET /process/wo/{wo_id}/gantt`)

The marquee feature. Returns a 30-day calendar timeline with:

- `timeline` — array of 30 day-cells with `day_number`, `date`, `weekday`, `is_sunday`.
- `stages` — each carries `day_number`, `planned_start_date`, `planned_end_date`, `days_allocated: 1`, `assignee_name`, `assignee_code`.

**Scheduling rule**: Day 1 = `WO.PLANNED_START_DATE`. One stage = one working day. Sundays skipped.

**Auto-assignment policy**: the endpoint **does not auto-assign**. It **does clear stale assignments to sales-role employees** (name/role/dept/designation/skills matching `sales` / `marketing` / `ragul`).

### Gantt UI

- Sticky header — WO number, product, units always visible.
- 4 summary tiles — Progress %, Planned days, Actual So Far, Failed Stages.
- Day 1–30 calendar header with date and weekday under each day number; Sundays in red.
- Per-row card shows stage name, type chip, hours, `1 day`, assignee chip, status pill, action buttons (▶ ✓ ✗).
- Drawer width `98vw` so all 30 day cells fit without horizontal scroll.

---

## Module 11 — Quality Management

Three-tier model: **template (QCChecklistItem) → instance (QCInspection) → result (QCInspectionResult)**.

**Workflow**:

1. `POST /quality/inspections` creates the inspection + spawns one result row per checklist item.
2. Per-item `PATCH /quality/results/{id}` records `PASS` / `FAIL` / `NEEDS_REWORK` / `NA`.
3. Failures auto-create NCRs.
4. `POST /quality/inspections/{id}/finalise` locks the inspection. Status computed:
   - All PASS → `PASS`
   - Any FAIL → `FAIL`
   - Only NEEDS_REWORK → `REWORK`

**Severity policy**:

| Severity | Failure consequence |
|---|---|
| CRITICAL | Auto-NCR, blocks WO `DONE`, requires re-inspection |
| MAJOR | Auto-NCR, blocks WO `DONE` |
| MINOR | Auto-NCR, does NOT block WO `DONE` |

**NCR resolution**: `OPEN → IN_PROGRESS → CLOSED`. Closure requires `ROOT_CAUSE` and `CORRECTIVE_ACTION`.

**WO → DONE gate**: all stages DONE + inspection passed + open NCRs closed.

---

## Module 12 — Machines

Registry of manufactured units. **Auto-registered** when a Work Order completes — one `Machine` row per unit produced.

Status flow: `IDLE → ACTIVE → MAINTENANCE → ACTIVE` (or decommissioned).

`MachineLog` is the append-only history of status changes. Used as service history until Phase 7 formalises it into structured `ServiceVisit` records.

`POST /machines/sync` bulk-registers machines for historical WOs that pre-date the auto-registration logic (idempotent).

---

## Module 13 — Notifications

Four channels, each with graceful degradation.

### Email

`email_service.py` tries Resend → SMTP fallback. Email types: quotation send, SO advance request, PO send, GRN rejection notice, leave / task approval links.

Dev override: `EMAIL_TESTING_OVERRIDE_TO` redirects all email to one address.

### WhatsApp

`whatsapp_service.py` tries CallMeBot (free) → WhatsApp Business Cloud API (paid). `notify_md_safe()` is fire-and-forget — never blocks parent op.

MD alert triggers: new customer, new enquiry, quotation → SO conversion, SO awaiting advance, SO auto-confirmed.

### In-app

`notification` table. NotificationBell component polls `/notifications/unread-count` every 10 s.

### Voice

Opt-in browser TTS (no external service). Speaks critical alerts (out-of-stock, failed QC, etc.). Employee dashboard variant reads today's task list on login.

---

## Module 14 — Chatbot & HR Assistant

Two bots intentionally separated.

### General ERP Chatbot

`gemini_service.py` — Google Gemini-backed. Scoped via system prompt to BVC24 questions only. Chat history client-side (not persisted). Falls back to friendly message when `GEMINI_API_KEY` not set.

### HR Assistant

`hr_assistant.py` — stateless rule-based bot for leave application. Walks employee through type / dates / reason via dialogue. Validates against actual `LeaveBalance` server-side. No LLM, no hallucination risk.

Both bots use a shared floating widget with BVC red gradient for user bubbles.

---

## Module 15 — Dashboard & Analytics

`DashboardHome` (`/`) is the executive cockpit:

- 4-grid stat cards (Employees / Projects / Tasks / Inventory).
- Recharts donut + bar visualisations.
- InventorySummaryCard with low-stock items.
- Pending acceptance + today's allocations + recent activity.

Refreshes every 10 s. Opt-in voice alerts.

`GET /analytics/dashboard-stats` returns all KPIs in one round trip.

`GET /analytics/chart-data?range=7d|30d|month` returns time-series.

**Reports**: `/reports/report/{module}.pdf|.xlsx` for sales / production / inventory / attendance / payroll / performance / quality.

`MDReview` (`/md-review`) is the MD-specific deeper KPI view (revenue trend, top performers, lead pipeline).

---

## Module 16 — Print & Public Links

### Print views (4)

- `/quotation-print/:id`
- `/so-print/:id`
- `/po-print/:id`
- `/grn-print/:id`

Each renders an A4-styled HTML page. Users press Ctrl+P → Save as PDF. No PDF library required.

### Public quotation link

`/q/{PUBLIC_TOKEN}` — customer-facing no-auth view + Approve/Reject endpoint. Token is `secrets.token_urlsafe(24)` — unguessable, per-quotation. Telemetry tracked.

### Other token-gated routes

- `/approve-task?token=...`, `/reject-task?token=...`
- `/leave/decide/{token}?action=approve|reject`
- `/biometric` (kiosk)
- `/apply-leave` (deep link)

All become inert after consumption.

---

# Part III — API Reference

A complete inventory follows. Endpoints are grouped by router. All endpoints require `Authorization: Bearer <JWT>` unless marked **(no auth)**.

## Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin-login`, `/login` | Admin login |
| POST | `/employee-login` | Employee login |
| POST | `/employee-logout` | Logout |
| GET | `/me` | Verify token |

## Organization

| Method | Path | Purpose |
|---|---|---|
| GET / POST / PUT / DELETE | `/departments` | Department CRUD |
| GET / POST / PUT / DELETE | `/designations` | Designation CRUD |
| GET / POST / DELETE | `/roles` | Role CRUD |
| GET | `/permissions` | List permissions |
| PUT | `/roles/{id}/permissions` | Assign permissions |
| POST | `/seed-org` | Apply MANUFACTURING preset |
| GET | `/org-presets` | List presets |
| POST | `/create-vendor`, GET `/vendors` | Vendor CRUD |

## HR — Employees

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-employee` | Create |
| GET | `/employees`, `/employees/{id}`, `/employees/by-code/{code}` | Lookup |
| POST | `/employees/by-code/{code}/submit-profile` | Self-registration |
| PUT | `/update-employee/{id}` | Update |
| PUT | `/employees/{id}/reset-password` | Reset password |
| POST | `/employees/{id}/upload-photo` | Photo |
| DELETE | `/delete-employee/{id}` | Remove |

## HR — Attendance

| Method | Path | Purpose |
|---|---|---|
| POST | `/attendance/check-in`, `/check-out`, `/mark-absent` | Manual |
| GET | `/attendance`, `/attendance/today`, `/attendance/live-board` | List |
| DELETE | `/attendance/{id}` | Remove |
| POST | `/biometric/enroll`, `/biometric/scan` | Biometric |
| GET | `/biometric/events` | Raw log |

## HR — Leave

| Method | Path | Purpose |
|---|---|---|
| POST | `/leave/apply` | Apply |
| GET | `/leave/decide/{token}?action=` **(no auth)** | Email link decision |
| PATCH | `/leave/{id}/approve`, `/reject`, `/cancel` | Workflow |
| GET | `/leave/pending`, `/all`, `/my-requests`, `/balance/{id}`, `/dashboard` | Queries |

## HR — Payroll

| Method | Path | Purpose |
|---|---|---|
| POST | `/payroll/generate` | Create run |
| GET | `/payroll/runs`, `/runs/{id}`, `/runs/{id}/slip/{eid}` | Query |
| PATCH | `/runs/{id}/finalize`, `/mark-paid` | Workflow |
| DELETE | `/runs/{id}` | Delete unpaid |

## HR — Performance

| Method | Path | Purpose |
|---|---|---|
| POST | `/performance/stars/compute` | Recalculate STAR |
| GET | `/performance/stars`, `/top`, `/employee/{id}/history` | Query |
| PATCH | `/performance/stars/{id}/action` | Approve/deny |

## CRM

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-customer` | Create + WhatsApp alert |
| GET | `/customers`, `/customers/{id}` | Lookup |
| PATCH | `/customers/{id}` | Update |
| DELETE | `/delete-customer/{id}` | Remove |
| PATCH | `/customers/{id}/lead-status` | Pipeline |
| POST | `/customers/enquiry` | Enquiry + WhatsApp alert |
| POST / GET / DELETE | `/customers/{id}/contacts[/{cid}]` | Contacts |
| POST / GET / PATCH / DELETE | `/customers/{id}/requirements[/{rid}]` | Requirements |
| POST | `/customers/{cid}/requirements/{rid}/to-project` | Convert |
| GET | `/connect/customer/{id}/360` | 360° view |

## Quotations

| Method | Path | Purpose |
|---|---|---|
| POST / GET / PATCH / DELETE | `/quotations[/{id}]` | CRUD |
| POST / PATCH / DELETE | `/quotations/{id}/lines[/{lid}]` | Lines |
| POST | `/quotations/{id}/send`, `/resend-email`, `/approve`, `/reject` | Workflow |
| POST | `/quotations/from-requirements` | Auto-build |
| GET | `/quotations/auto-price` | Suggest |
| GET / POST | `/q/{token}` / `/q/{token}/respond` **(no auth)** | Public link |
| GET / DELETE | `/quotations/{id}/activity[/{aid}]` | Timeline |

## Sales Orders

| Method | Path | Purpose |
|---|---|---|
| POST / GET / PATCH / DELETE | `/sales-orders[/{id}]` | CRUD |
| POST / PATCH / DELETE | `/sales-orders/{id}/lines[/{lid}]` | Lines |
| POST | `/sales-orders/{id}/confirm` | Send advance request |
| POST | `/sales-orders/{id}/payment` | Record milestone, auto-confirm |
| POST | `/sales-orders/{id}/start-production` | Spawn projects |
| POST | `/sales-orders/{id}/ship`, `/deliver`, `/close`, `/cancel` | Workflow |
| POST | `/sales-orders/from-quotation` | Convert quote |
| GET / DELETE | `/sales-orders/{id}/activity[/{aid}]` | Timeline |

## Purchase Orders

| Method | Path | Purpose |
|---|---|---|
| POST / GET / PATCH / DELETE | `/purchase-orders[/{id}]` | CRUD |
| POST / PATCH / DELETE | `/purchase-orders/{id}/lines[/{lid}]` | Lines |
| POST | `/purchase-orders/{id}/send`, `/resend-email`, `/confirm`, `/cancel` | Workflow |
| POST | `/purchase-orders/{id}/grn` | Record GRN |
| GET | `/purchase-orders/{id}/grn`, `/grn/{gid}` | Query |
| POST | `/purchase-orders/grn/{gid}/finalize` | Push to inventory |
| POST | `/purchase-orders/grn/{gid}/resend-rejection-notice` | Notify supplier |
| DELETE | `/purchase-orders/grn/{gid}` | Delete draft |
| POST | `/purchase-orders/auto-from-project` | Generate from BOM |
| GET / DELETE | `/purchase-orders/{id}/activity[/{aid}]` | Timeline |

## Suppliers

| Method | Path | Purpose |
|---|---|---|
| POST / GET / PATCH / DELETE | `/suppliers[/{id}]` | CRUD |
| GET | `/suppliers/categories` | List categories |
| GET | `/connect/supplier/{id}/360` | 360° view |

## Inventory

| Method | Path | Purpose |
|---|---|---|
| GET | `/materials-catalog`, `/materials/for-me`, `/materials` | List |
| POST | `/create-material`, `/seed-materials` | Create |
| PUT | `/materials-catalog/{id}/departments`, `/update-stock/{id}` | Update |
| DELETE | `/delete-material/{id}` | Remove |
| GET | `/inventory/full`, `/inventory/{id}/movements` | Query |
| POST | `/inventory/{id}/adjust` | Stock movement |

## Projects & Tasks

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-project`, `/projects/from-product`, `/projects/{id}/backfill-tasks`, `/projects/auto-assign-missing` | Create / spawn |
| GET / PATCH / DELETE | `/projects[/{id}]` | CRUD |
| POST | `/create-task` | Task |
| GET | `/tasks`, `/project/{id}/tasks` | List |
| PUT | `/start-task/{id}`, `/complete-task/{id}`, `/hold-task/{id}` | Status |
| POST / PUT / PATCH / DELETE | `/task-assignment[/{id}]` | Assignment |
| GET / PATCH | `/employee/{ref}/today-task`, `/tasks`, `/pending-acceptance`, `/pending-from-yesterday` | Employee views |
| GET | `/approve-task?token=...`, `/reject-task?token=...` **(no auth)** | Email link |
| POST | `/task-proposals/cleanup-expired` | Cron |
| GET | `/connect/project/{id}/360` | 360° view |

## Production & Process

| Method | Path | Purpose |
|---|---|---|
| POST / GET / PATCH / DELETE | `/production/models[/{id}]` | Models |
| POST | `/production/models/{id}/seed-default-bom` | Seed 10-stage flow |
| POST / GET / PATCH / DELETE | `/production/models/{id}/bom`, `/production/bom/{id}` | BOM |
| POST | `/production/bom/{id}/upload-image` | Image |
| PATCH | `/bom-items/{id}/classify` | Set ITEM_TYPE |
| POST / GET / PATCH / DELETE | `/stages[/{id}]` | Process stages |
| POST / GET / PATCH / DELETE | `/production/work-orders[/{id}]` | Work Orders |
| POST | `/process/spawn-for-wo/{id}` | Spawn stage progress |
| GET / PATCH | `/process/wo/{id}/stages[/{sid}]` | Stage progress |
| GET | `/process/wo/{id}/gantt` | Gantt timeline |
| GET | `/production/dashboard` | KPIs |

## Quality

| Method | Path | Purpose |
|---|---|---|
| POST / GET / PATCH / DELETE | `/quality/checklist-items`, `/checklist/{model_id}` | Checklists |
| POST / GET / PATCH | `/quality/inspections[/{id}]`, `/results/{id}` | Inspections |
| POST | `/quality/inspections/{id}/finalise` | Lock + NCRs |
| GET / PATCH | `/quality/ncrs[/{id}]` | NCRs |
| GET | `/quality/dashboard` | KPIs |

## Machines

| Method | Path | Purpose |
|---|---|---|
| POST / GET / PUT / DELETE | `/machines[/{id}]` | CRUD |
| POST | `/machines/sync` | Bulk register |
| GET | `/machines/machine-logs/{id}` | History |

## Notifications

| Method | Path | Purpose |
|---|---|---|
| POST / GET / DELETE | `/notifications[/{id}]` | CRUD |
| GET | `/notifications/unread-count` | Badge |
| PUT | `/notifications/{id}/read`, `/mark-all-read` | Mark read |
| POST | `/notifications/generate` | System auto |

## WhatsApp

| Method | Path | Purpose |
|---|---|---|
| GET | `/whatsapp/diagnose` | Status |
| POST | `/whatsapp/test` | Send test |

## Chat / HR Assistant

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat`, `/chat/stream` | Gemini chat |
| GET | `/chat/health`, `/chat/suggestions` | Status |
| POST | `/hr-bot/message` | HR conversation |
| GET | `/hr-bot/policy`, `/hr-bot/diagnose` | Status |

## Connect (360° views)

| Method | Path | Purpose |
|---|---|---|
| GET | `/connect/employee/{id}/360` | Employee 360 |
| GET | `/connect/project/{id}/360` | Project 360 |
| GET | `/connect/customer/{id}/360` | Customer 360 |
| GET | `/connect/work-order/{id}/360` | WO 360 |
| GET | `/connect/supplier/{id}/360` | Supplier 360 |
| GET | `/connect/workflow/snapshot` | Global snapshot |

## Analytics / Reports / Settings

| Method | Path | Purpose |
|---|---|---|
| GET | `/analytics/dashboard-stats`, `/chart-data` | Dashboard |
| GET | `/reports/report/{module}.pdf`, `.xlsx` | Reports |
| GET / PUT | `/settings`, `/settings/email-alerts` | Settings |
| POST | `/settings/test-email` | Test |

---

# Part IV — Appendix

## A. Glossary

| Term | Meaning |
|---|---|
| AMC | Annual Maintenance Contract |
| BOM | Bill of Materials |
| BVC | Bharath Vending Corporation |
| BVC24 | The product / system name |
| CallMeBot | Free WhatsApp bridge |
| CRM | Customer Relationship Management |
| ERP | Enterprise Resource Planning |
| GRN | Goods Receipt Note |
| GST | Indian Goods & Services Tax |
| HSN | Harmonized System of Nomenclature |
| JWT | JSON Web Token |
| LOP | Loss of Pay |
| MD | Managing Director |
| NCR | Non-Conformance Report |
| PO | Purchase Order |
| PROCESS | BOM in-house manufacture |
| PURCHASE | BOM external sourcing |
| QC | Quality Control |
| SO | Sales Order |
| STAR | Monthly performance rating system |
| UPI | Indian instant payment |
| VENDOR | ERP tenant |
| WO | Work Order |

## B. State Machines Summary

```
Quotation:  DRAFT → SENT → APPROVED → CONVERTED
                              ↘ REJECTED
                       ↘ REJECTED

Sales Order: DRAFT → AWAITING_ADVANCE → CONFIRMED → IN_PRODUCTION
                                                 → SHIPPED → DELIVERED → CLOSED
             (any) → CANCELLED

Purchase Order: DRAFT → SENT → CONFIRMED → PARTIAL_RECEIVED → RECEIVED
                (any) → CANCELLED

GRN: DRAFT → FINAL (pushes to inventory)

Work Order: PLANNED → IN_PROGRESS → DONE (requires stages + QC + NCRs)
            (any) → ON_HOLD / CANCELLED

WO Stage:   PENDING → IN_PROGRESS → DONE / FAILED / SKIPPED

Project:    PENDING → IN_PROGRESS → COMPLETED
            (any) → ON_HOLD / CANCELLED

Task / TaskAssignment:
            PENDING_APPROVAL → APPROVED → ACCEPTED → IN_PROGRESS → COMPLETED
                            → REJECTED / EXPIRED

Leave:      PENDING_APPROVAL → APPROVED / REJECTED / CANCELLED / EXPIRED

QC Inspection: PENDING → PASS / FAIL / REWORK (failures auto-open NCRs)

NCR:        OPEN → IN_PROGRESS → CLOSED

Machine:    IDLE → ACTIVE → MAINTENANCE → ACTIVE
                                       → decommissioned (terminal)

Customer Lead: NEW → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED_WON / CLOSED_LOST

Customer Requirement: DRAFT → CONFIRMED → QUOTED → ORDERED / CANCELLED
```

## C. Environment Variables (essential)

```env
# Required
MY_SQL=localhost:3306
DB_NAME=bvc24
SECRET_KEY=<32+ random chars>
ALGORITHM=HS256

# Email — Resend (preferred)
RESEND_API_KEY=re_...
SMTP_FROM=erp@bvc24.in
SMTP_FROM_NAME=BVC24 ERP

# Or SMTP fallback
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_USE_TLS=true

# Approver / URLs
APPROVER_EMAIL=md@bvc24.in
APPROVER_NAME=Managing Director
FRONTEND_URL=https://erp.bvc24.in
BACKEND_URL=https://erp.bvc24.in/api

# WhatsApp (optional, CallMeBot — free)
CALLMEBOT_API_KEY=...
MD_WHATSAPP_NUMBER=+91...

# Or WhatsApp Cloud API
WHATSAPP_TOKEN=EAAQ...
WHATSAPP_PHONE_NUMBER_ID=...

# Gemini (optional)
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-1.5-flash

# Dev only
EMAIL_TESTING_OVERRIDE_TO=test@example.com
```

See `docs/appendix/C-environment-variables.md` for the complete reference.

## D. Roadmap

### Planned phases

- **Phase 6** — Invoicing with GST e-Invoice IRN, e-Way Bill, credit/debit notes, payment reconciliation.
- **Phase 7** — Service / AMC contracts, complaint tickets, service visit scheduling, spare-parts consumption, renewal reminders.

### Cross-cutting

- Alembic migrations replacing the `IF NOT EXISTS` block when schema changes get more complex.
- Per-permission decorator enforcement across all routes.
- Refresh tokens to extend session.
- Rate limiting on login.
- Background jobs (Celery + Redis) for heavy reports and bulk emails.
- Materialised summary tables when dashboard load grows.
- Mobile app (React Native shell).
- Tamil + Hindi UI translations.
- Per-department approver configuration.
- WebSocket layer when polling becomes a bottleneck.
- Knowledge-base chatbot (RAG over this `/docs` folder).
- PDF attachment variant of customer-facing documents.
- Multi-currency support.
- Centralised audit log table.

### Known Gaps in Release 1.0

- Seed endpoints not gated by environment.
- Permission enforcement is role-level, not per-permission.
- Refresh-token endpoint absent.
- No rate limiting on `/admin-login`.
- Email queue is synchronous.
- File uploads have no virus scanning.

## E. Changelog

### Release 1.0 — Production Ready (current)

- **Phase 5 — Sales Orders with Payment-Gated Workflow**: AWAITING_ADVANCE status, advance amount + due date in email, auto-confirm on advance payment, MD WhatsApp alerts at three SO events, advance banner in UI.
- **Production & Gantt rewrite**: 30-day calendar header, one-stage-per-working-day, Sundays skipped, drawer 98vw, auto-assignment removed, sales-role employees excluded from production stages.
- **Sticky-header modal pattern** applied across Employee profile, Quotation, Sales Order, Purchase Order modals + Work Order Gantt drawer.
- **WhatsApp notifications**: `whatsapp_service.py` with CallMeBot + Cloud API, `notify_md_safe()`, wired across CRM and SO events.
- **Inventory rebuild**: BVC red theme, KPI tiles, MaterialCard with stock fill bar, AdjustModal, DetailDrawer, category auto-detection.
- **BVC red theme** applied consistently (login, sidebar, modals, chatbot, gradients).
- **Chatbot**: `gemini_service.py` (general ERP) + `hr_assistant.py` (stateless rule-based for leave).

### Release 0.4 — Procurement (Phase 4)

Supplier master, PO CRUD with workflow, GRN with partial receipts and rejections, GRN-to-inventory pipeline, auto-PO from project BOM, PO email + rejection-notice resend.

### Release 0.3 — CRM & Quotations (Phase 3)

Customer master with lead pipeline, contacts, requirements, Quotation CRUD with lines/totals/terms, SEND → APPROVE → CONVERT workflow, public share token, email dispatch with view telemetry, auto-pricing from BOM, A4 print.

### Release 0.2 — HR Operations (Phase 2)

Biometric-driven attendance, leave with token-based email approval (CASUAL/SICK/EARNED quotas, auto-LOP), payroll runs from attendance + tasks, STAR performance with weighted formula and recommendations, MD Review.

### Release 0.1 — Foundation (Phase 1)

Vendor / multi-tenancy, MANUFACTURING org preset, Employee master with UUID PK and profile self-registration, JWT auth (admin + employee), bcrypt passwords, auto-migration framework.

---

## End of Document

For the multi-file modular edition see `docs/README.md` and the structured folders:

- `docs/01-executive-summary.md` … `docs/06-database-schema.md` — Foundation
- `docs/modules/01-organization.md` … `docs/modules/16-print-and-public-links.md` — 16 module documents
- `docs/api/01-auth.md` … `docs/api/14-misc.md` — Complete API reference
- `docs/appendix/A-glossary.md` … `docs/appendix/E-changelog.md` — Reference appendix

© Bharath Vending Corporation · Chennai, Tamil Nadu, India · `www.bvc24.in`
