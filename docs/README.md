# BVC24 ERP — Documentation Index

**Project**: BVC24 — Vendor-based Manufacturing ERP
**Customer**: Bharath Vending Corporation (BVC)
**Edition**: 1.0 (Production-ready)
**Document Owner**: Engineering & Implementation Team

This folder contains the complete technical and business documentation for the BVC24 Manufacturing ERP system. The documentation is delivered in two formats:

1. **Master single-file document** — [`BVC24_DOCUMENTATION.md`](./BVC24_DOCUMENTATION.md) — a continuous, printable document suitable for export to PDF and circulation to a customer or stakeholder.
2. **Modular reference** — the structured directory below, suited for engineering reference and onboarding.

---

## Table of Contents

### 1. Foundation

| # | Document | Purpose |
|---|----------|---------|
| 01 | [Executive Summary](./01-executive-summary.md) | What BVC24 is, business value, scope, stakeholders. |
| 02 | [System Architecture](./02-system-architecture.md) | Layered architecture, components, data flow, integration map. |
| 03 | [Technology Stack](./03-tech-stack.md) | Frontend, backend, database, third-party services. |
| 04 | [Installation & Deployment](./04-installation-and-deployment.md) | Local dev, environment setup, production deployment, auto-migration. |
| 05 | [Security & Authentication](./05-security-and-authentication.md) | JWT auth, password hashing, multi-tenancy, role-based access. |
| 06 | [Database Schema](./06-database-schema.md) | Complete data dictionary — every table, every important column. |

### 2. Functional Modules

| # | Module | Owner Area |
|---|--------|------------|
| 01 | [Organization Management](./modules/01-organization.md) | Vendor, Department, Designation, Role, Permission |
| 02 | [Human Resources](./modules/02-hr.md) | Employees, Attendance, Leave, Payroll, Performance |
| 03 | [CRM](./modules/03-crm.md) | Customers, Enquiries, Requirements, Lead pipeline |
| 04 | [Quotations](./modules/04-quotations.md) | Quote builder, public sharing, auto-pricing |
| 05 | [Sales Orders](./modules/05-sales-orders.md) | Payment-gated SO workflow, project spawning |
| 06 | [Purchase Orders](./modules/06-purchase-orders.md) | PO lifecycle, GRN, auto-from-project |
| 07 | [Suppliers](./modules/07-suppliers.md) | Supplier master, categories, contact history |
| 08 | [Inventory](./modules/08-inventory.md) | Materials, stock movements, adjustments |
| 09 | [Projects & Tasks](./modules/09-projects-and-tasks.md) | Project lifecycle, task assignment, daily allocation |
| 10 | [Production & BOM](./modules/10-production-and-bom.md) | Product models, BOM, Work Orders, Process Stages, Gantt |
| 11 | [Quality Management](./modules/11-quality.md) | Checklists, inspections, NCRs |
| 12 | [Machines](./modules/12-machines.md) | Manufactured unit registry, status logs |
| 13 | [Notifications](./modules/13-notifications.md) | Email (Resend / SMTP), WhatsApp, in-app, voice |
| 14 | [Chatbot & HR Assistant](./modules/14-chatbot.md) | Conversational helpers (Gemini, rule-based) |
| 15 | [Dashboard & Analytics](./modules/15-dashboard-analytics.md) | KPIs, charts, real-time refresh |
| 16 | [Print & Public Links](./modules/16-print-and-public-links.md) | Quotation / SO / PO / GRN print views, public share tokens |

### 3. API Reference

The HTTP API is organised by router. Each file is a complete endpoint reference with method, path, parameters, and notes.

| File | Coverage |
|------|----------|
| [01 — Authentication](./api/01-auth.md) | Login, JWT, role guards |
| [02 — Organization](./api/02-organization.md) | Departments, designations, roles, permissions |
| [03 — HR](./api/03-hr.md) | Employees, attendance, leave, payroll, performance |
| [04 — CRM](./api/04-crm.md) | Customers, enquiries, requirements |
| [05 — Quotations](./api/05-quotations.md) | Quote CRUD, workflow, public token |
| [06 — Sales Orders](./api/06-sales-orders.md) | SO lifecycle, payment, project spawn |
| [07 — Purchase Orders](./api/07-purchase-orders.md) | PO lifecycle, GRN |
| [08 — Suppliers](./api/08-suppliers.md) | Supplier CRUD |
| [09 — Inventory](./api/09-inventory.md) | Material catalog, stock, movements |
| [10 — Projects & Tasks](./api/10-projects-and-tasks.md) | Projects, tasks, assignments, approvals |
| [11 — Production & Process](./api/11-production-and-process.md) | Models, BOM, Work Orders, Process Stages |
| [12 — Quality](./api/12-quality.md) | Checklists, inspections, NCRs |
| [13 — Machines](./api/13-machines.md) | Machine registry & logs |
| [14 — Misc & Integrations](./api/14-misc.md) | Notifications, WhatsApp, chatbot, 360 views, reports |

### 4. Appendix

| File | Contents |
|------|----------|
| [A — Glossary](./appendix/A-glossary.md) | Domain terms (SO, GRN, BOM, NCR, MD, etc.) |
| [B — State Machines](./appendix/B-state-machines.md) | Quotation, SO, PO, WO, Project, Leave, Inspection state diagrams |
| [C — Environment Variables](./appendix/C-environment-variables.md) | All `os.getenv()` settings with example values |
| [D — Roadmap](./appendix/D-roadmap.md) | Planned phases, known gaps, future work |
| [E — Changelog](./appendix/E-changelog.md) | Phase-wise release notes |

---

## Quick Links

- **Backend base URL (dev)**: `http://127.0.0.1:8001`
- **Frontend base URL (dev)**: `http://localhost:5173`
- **API Documentation (Swagger)**: `http://127.0.0.1:8001/docs`
- **Total HTTP endpoints**: ~200
- **Total database tables**: 50+
- **Frontend pages**: 35
- **Backend route files**: 34

---

## How to Read This Document

- **For a customer / MD**: start with [Executive Summary](./01-executive-summary.md), then skim the module documents (no code required).
- **For a CTO / Architect**: [System Architecture](./02-system-architecture.md), [Tech Stack](./03-tech-stack.md), [Security](./05-security-and-authentication.md), [Database Schema](./06-database-schema.md), then state machines in Appendix B.
- **For an engineer joining the team**: [Installation](./04-installation-and-deployment.md), the API reference, and the relevant module document for the area they own.
- **For a single hand-off PDF**: print [`BVC24_DOCUMENTATION.md`](./BVC24_DOCUMENTATION.md) directly.

---

© Bharath Vending Corporation · Chennai, Tamil Nadu, India · `www.bvc24.in`
