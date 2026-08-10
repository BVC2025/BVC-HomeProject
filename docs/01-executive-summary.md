# 01 — Executive Summary

## 1.1 Product Identity

**BVC24** is a vendor-based manufacturing ERP designed for **Bharath Vending Corporation (BVC)** — a Chennai-headquartered manufacturer of automated vending machines (snack, beverage, combo, medicine, and special-purpose dispensers).

The platform consolidates the day-to-day operations of a manufacturing-and-installation business into a single web application:

- **Sales** — enquiries, quotations, sales orders, payment milestones.
- **Production** — product catalog, bill of materials (BOM), work orders, process stages, Gantt scheduling, quality inspections.
- **Procurement** — supplier master, purchase orders, goods receipt notes (GRN), inventory updates.
- **People** — employees, attendance (with biometric), leave with email-token approvals, payroll, monthly STAR performance ratings.
- **Customer Lifecycle** — 360° customer view, requirements pipeline, post-sale installation projects, AMC visibility.
- **Operations** — daily task allocation, real-time dashboards, MD-level WhatsApp alerts on revenue events.

## 1.2 Business Value Proposition

BVC24 replaces a patchwork of spreadsheets, WhatsApp chats, and paper trails with a single source of truth that follows the cash flow:

```
Enquiry → Quotation → Sales Order → Advance Payment → Production →
Quality Inspection → Shipping → Installation → Final Payment → AMC
```

Every state transition is timestamped, logged in an activity timeline, and gated by a business rule:

- A **Sales Order cannot enter production** until the customer's advance payment is recorded (and verified to meet the configured advance percentage).
- A **Work Order cannot be closed** until its QC inspection is finalised.
- A **Goods Receipt Note feeds inventory only after finalisation** — preventing accidental stock changes during partial deliveries.
- **Leave requests issue a single email** to the approver with one-click approve / reject tokens (no portal login required for the approver).

These guard rails turn process discipline into a property of the software, not a property of human memory.

## 1.3 Stakeholder Map

| Stakeholder | Primary Screens | Key Outcomes |
|---|---|---|
| Managing Director (MD) | MD Review, Dashboard Home, WhatsApp alerts | Cash-in events, top performers, blocked SOs |
| Sales Team | CRM, Quotations, Sales Orders | Quote → SO conversion, payment progress |
| Production Head | Production, Work Orders, Gantt | Stage progress, employee allocation |
| Procurement Team | Purchase Orders, Suppliers, Inventory | PO funnel, GRN, supplier performance |
| Quality Team | Quality Management, NCRs | Inspection pass-rate, rework |
| HR | Employees, Attendance, Leave, Payroll, Performance | Compliance, payouts, recognitions |
| Floor Employees | Employee Dashboard, Apply Leave, Biometric Check-in | Today's tasks, leave balance |
| Customer (external) | Public Quotation link (`/q/:token`) | View & respond to a quote without an account |

## 1.4 Scope of Implementation (Current Release)

### Implemented and live

- ✅ **Phase 1** — Organization, IAM, Employees (with profile self-registration, biometric, photos)
- ✅ **Phase 2** — Attendance (with biometric integration), Leave management (token-based approval), Payroll (auto-computed from attendance + task bonus), Monthly STAR performance ratings
- ✅ **Phase 3** — CRM (Customers, Contacts, Requirements, Lead pipeline, Quotations with public share token, auto-pricing from BOM)
- ✅ **Phase 4** — Procurement (Suppliers, Purchase Orders, GRN with partial-receipt support, auto-PO from project BOM)
- ✅ **Phase 5** — Sales Orders with payment-gated workflow (advance/dispatch/installation milestones, auto-confirm on full advance), auto-project spawning, A4 print, activity timeline, email-to-customer
- ✅ **Production** — Product Models, BOM (with images and PURCHASE/PROCESS classification), Work Orders, Process Stages with Gantt timeline, one-stage-per-working-day scheduling with Sundays off
- ✅ **Quality** — Inspection checklists per model, NCRs, inspection finalisation gate
- ✅ **Machines** — Auto-registered from Work Order completion, status logs
- ✅ **Dashboard & Analytics** — Real-time stats, charts, voice-alert critical events
- ✅ **Notifications** — Email (Resend + SMTP fallback), WhatsApp (CallMeBot + WhatsApp Business API), in-app, optional voice
- ✅ **Chatbot** — HR Assistant (rule-based leave application), general ERP chatbot (Gemini-powered)

### Planned (not in this release)

- ⏳ **Phase 6** — Invoicing / GST e-Invoice / e-Way Bill
- ⏳ **Phase 7** — Service / AMC contracts, complaint tickets, service visit scheduling
- ⏳ Multi-currency, multi-language, mobile app

See [Appendix D — Roadmap](./appendix/D-roadmap.md) for details.

## 1.5 Headline Metrics

| Surface | Count |
|---|---|
| Backend route files | 34 |
| Backend HTTP endpoints | ~200 |
| Frontend pages | 35 |
| Frontend print views | 4 |
| Public (no-auth) routes | 2 |
| Database tables | 50+ |
| Implemented modules (phases) | 5 (P1–P5) |
| Third-party integrations | 5 (Resend, SMTP, Gemini, CallMeBot, WhatsApp Business API) |

## 1.6 Deployment Model

The application is a **two-process system**:

- A **FastAPI** Python backend (`uvicorn app.main:app --port 8001`)
- A **React + Vite** frontend (`npm run dev` for dev, `npm run build` for production static bundle)
- A **MySQL** database

It runs on a single VM for the current scale (≤200 employees, ≤1,000 active records per module per month). Horizontal scaling is straightforward — the backend is stateless except for file uploads, and the database is the only shared store. See [Installation](./04-installation-and-deployment.md) for the deployment guide.

## 1.7 Document Conventions

- **Code paths**: linked as `file.py:line` where useful.
- **State names** are written in `UPPER_SNAKE_CASE` (e.g., `AWAITING_ADVANCE`).
- **HTTP endpoints**: written as `POST /path/{id}`.
- **Database tables and columns**: tables are `lower_snake`, columns are `UPPER_SNAKE`.
- **Indian Rupee** is rendered `₹` in user-facing UI and `Rs.` in printable documents.

---

Next: [02 — System Architecture](./02-system-architecture.md)
