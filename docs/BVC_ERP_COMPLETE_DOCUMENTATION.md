# BVC24 ERP — Complete System Documentation

**Product**: Bharath Vending Corporation — Vendor-based Manufacturing ERP
**Prepared for**: Bharath Vending Corporation
**Version**: 1.0
**Documentation date**: 2026-07-10

---

## 1. Executive Summary

BVC24 ERP is an integrated, on-premise Enterprise Resource Planning system built specifically for **Bharath Vending Corporation**, a vending-machine manufacturer serving Tier-1 and Tier-2 markets across India. The platform consolidates every business-critical workflow — from lead capture through manufacturing, dispatch, payroll and after-sales — into a single browser-accessible application backed by an in-office server.

The system serves three primary user groups:

- **Employees** — self-service portal for attendance, leave, memos, payslips and task updates
- **Managers / HR** — team dashboards, approvals, reports, and performance analytics
- **Administrators** — full control over master data, users, RBAC, deployment, and system settings

Key differentiators of this implementation:

- **Biometric-driven attendance** integrated live with an eSSL X2008 fingerprint device
- **AI-powered HR assistant** using self-hosted LLMs (Ollama with Qwen 2.5), with a voice-first roadmap
- **Zero third-party dependencies** for AI or attendance — everything runs on the office server
- **Real-time payroll calculation** driven by biometric attendance plus configurable salary structures
- **Multi-tenant ready** via a `VENDOR_ID` scope on every business table

---

## 2. Business Objectives

BVC24 ERP was commissioned to address the following operational pain points:

1. **Manual attendance recording**: Register-based attendance was error-prone and disconnected from payroll.
2. **Fragmented data**: Employee, sales, project, and inventory data lived in separate spreadsheets.
3. **Slow decision-making**: HR and management had no live view of workforce productivity, project progress, or cash position.
4. **Payroll cycle burden**: End-of-month salary calculation required 3-4 days of manual reconciliation.
5. **Compliance risk**: Employee data, salary structures, and PF/ESI records were stored on individual laptops with no audit trail.

Business benefits realised:

| Metric | Before | After BVC24 ERP |
|---|---|---|
| Attendance capture latency | End of day (paper) | Live via biometric bridge (< 2 min) |
| Payroll cycle time | 3-4 days | Same-day (auto-computed) |
| Employee self-service queries to HR | ~40 / week | ~5 / week |
| Task assignment | Verbal / whiteboard | Structured, tracked, reportable |
| Onboarding paperwork | 2 days per hire | 20 minutes |

---

## 3. Guiding Principles

The system was designed against the following non-negotiable principles:

- **On-prem first** — payroll, salary, appraisal, and health data must not leave the office. No third-party AI APIs, no cloud SaaS dependencies.
- **Grounded AI, not hallucinated** — every factual response the AI produces must cite a source document or database row.
- **Role-aware from the first token** — an employee can never see peers' salaries; a manager cannot approve their own leave.
- **Observable end-to-end** — every mutation is auditable and reversible.
- **Terse, professional UI** — no emojis in the product surface; inline SVG icons only; BVC red + white + gold palette.
- **Additive over destructive** — new features never break existing modules; auto-migrations handle schema evolution.

---

## 4. System Architecture

BVC24 ERP is a **three-tier web application** with an optional AI services tier:

```
┌────────────────────────────────────────────────────────────────┐
│  CLIENT LAYER                                                  │
│  React 19 + Vite (SPA)  |  Chrome on office LAN                │
│  Mobile-responsive · CSS Modules · React Router                │
└─────────────────────────┬──────────────────────────────────────┘
                          │ HTTPS + WebSocket
┌─────────────────────────▼──────────────────────────────────────┐
│  API LAYER                                                     │
│  FastAPI 0.115 + Pydantic v2 + SQLAlchemy 2                    │
│  Uvicorn (ASGI) · JWT auth · CORS · rate limits                │
│  Background scheduler: APScheduler (biometric sync + nightly)  │
└─────────────────────────┬──────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────────┐
│  AI SERVICES (self-hosted, optional)                           │
│  Ollama (Qwen 2.5 7B · Phi-3 mini · nomic-embed-text)          │
│  Vector store: JSON-backed cosine index                        │
│  Speech: Whisper (STT) · Piper (TTS) — Phase-2                 │
└─────────────────────────┬──────────────────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────────────────┐
│  DATA LAYER                                                    │
│  MySQL 8 (InnoDB, utf8mb4) — system of record                  │
│  Filesystem: /static (uploads, payslip PDFs, resumes)          │
└────────────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────┼──────────────────────────────────────┐
│  INTEGRATIONS                                                  │
│  eSSL X2008 biometric device (TCP :4370, pyzk protocol)        │
│  SMTP / Resend for transactional email                         │
│  WhatsApp Business (roadmap)                                   │
└────────────────────────────────────────────────────────────────┘
```

---

## 5. Technology Stack

The stack was selected for zero-license-cost, on-prem operability, and long-term community support.

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React 19 + Vite + React Router 7 | Fast HMR, small bundle, mature ecosystem |
| UI styling | CSS Modules (no framework) | Scoped styles, no runtime cost, no vendor lock-in |
| Backend | FastAPI 0.115 + Pydantic v2 | Type-safe request/response, OpenAPI auto-generated |
| ORM | SQLAlchemy 2.0 | Battle-tested, expressive query API |
| Database | MySQL 8.0 (InnoDB) | Familiar SQL surface, robust replication |
| Auth | JWT (python-jose) + bcrypt | Stateless tokens, industry standard |
| PDF generation | ReportLab + markdown | Pure-Python, no external binaries |
| Biometric bridge | `pyzk` 0.9 (Python) | Open-source ZKTeco / eSSL protocol client |
| Background jobs | APScheduler 3.10 | In-process, no separate worker to manage |
| LLM runtime | Ollama (Qwen 2.5 7B, Phi-3 mini) | Local inference, no API keys |
| Embeddings | nomic-embed-text | Multilingual, permissive licence |
| Deployment | Ubuntu 22.04 · Jenkins · systemd · Nginx | Standard on-prem Linux stack |
| CI/CD | Jenkins pipeline (Git → build → deploy) | Already deployed by BVC IT |

---

## 6. Module Catalogue

The system is organised into six functional families, mirroring the sidebar navigation.

### 6.1 HRMS — Human Resource Management

| Module | Purpose |
|---|---|
| **RBAC / Role Management** | Fine-grained permissions per role. Every route and every AI tool call passes through a permission check. |
| **Employees** | Complete personnel master — profile, documents, salary structure, RBAC role. |
| **Memos** | Internal broadcast messages with priority, department scope, and read acknowledgement. |
| **Attendance** | Live biometric-driven attendance with LATE tracking (9:15 grace), overtime, and geofence fallback. |
| **Shift Management** | Shift definitions and per-employee shift assignments. |
| **Leave Management** | Casual / Sick / Earned leave with balances, approval workflow, and email notifications. |
| **Payroll** | Salary components (BASIC + HRA + DA + allowances), PT / PF / ESI configuration. |
| **Star Performance** | 4-dimension scoring (Attendance / Task / Leave / Permission) with monthly stars, prorated for the current month, nightly auto-recompute. |
| **Allowances** | Custom recurring allowances per employee. |
| **Recruitment** | Job postings, candidate pipeline, application tracking. |
| **Onboarding** | Token-based invite flow — HR emails a link; candidate self-registers with password + profile. |
| **HR Automation** | AI-assisted memo generation, complaint routing, offer letter drafting. |
| **Monthly Reports** | Auto-generated per-employee monthly summary — working days, present, absent, leave breakdown, deductions, net payable. Downloadable as PDF. |

### 6.2 CRM & Sales

| Module | Purpose |
|---|---|
| Customer master | Full contact history, GST, addresses, credit limit |
| Lead pipeline | New → Contacted → Qualified → Won / Lost with follow-up dates |
| Quotations | Line-item quotes with public share-link and email tracking |
| Sales Orders | Confirmed orders with advance-payment tracking |
| Invoices | Tax-compliant invoice generation |

### 6.3 Project & Manufacturing

| Module | Purpose |
|---|---|
| Projects | Kanban board, task assignments, star statuses, deletion controls |
| Product Models | Machine catalogue (Snack Combo, Beverage, Medical Dispenser, etc.) |
| BOM (Bill of Materials) | Parts and quantities per model |
| Work Orders | Manufacturing runs tied to sales orders |
| Process Stages | Per-work-order production stages with assignee and completion tracking |

### 6.4 Purchase & Inventory

| Module | Purpose |
|---|---|
| Suppliers | Vendor master, payment terms, past PO history |
| Purchase Orders | Draft → Approved → Received lifecycle |
| GRN (Goods Received Notes) | Inspection and stock-in logging |
| Inventory | Live stock levels with reorder-point alerts |

### 6.5 Reports & Analytics

| Module | Purpose |
|---|---|
| Dashboards | Enterprise Command Center — KPIs across HR, sales, manufacturing |
| Attendance reports | Daily, monthly, per-employee |
| Payroll reports | Monthly attendance report tied to salary calculation |
| Sales analytics | Revenue trends, lead conversion, top customers |

### 6.6 System

| Module | Purpose |
|---|---|
| Company Settings | Master company profile, GST, addresses, logos |
| Holiday Calendar | Vendor-scoped declared holidays used by attendance and payroll calculations |
| Geofence Settings | Office coordinates + radius for GPS-gated attendance |
| Settings | Office hours, late grace, permission cap, etc. |

---

## 7. Biometric Attendance Integration

The system integrates directly with an **eSSL X2008** biometric fingerprint device deployed at the office entrance.

### 7.1 Device Specifications

| Property | Value |
|---|---|
| Model | eSSL X2008 |
| Firmware | Ver 8.0.4.7 (2025-02-12) |
| Fingerprint algorithm | VX10.0 |
| Serial number | JNP2255102739 |
| Communication | TCP/IP on port 4370 |
| Office LAN address | 192.168.1.201 |

### 7.2 Data Flow

```
Employee fingerprint scan
         │
         ▼
Device stores punch (user_id, timestamp)
         │
         │  every 2 minutes (APScheduler)
         ▼
Bridge service (pyzk) — connects, fetches new events
         │
         ▼
Maps device user_id → Employee.FINGERPRINT_ID
         │
         ▼
Attendance table — computes STATUS, LATE_MINUTES, WORKED_HOURS
         │
         ▼
Monthly reports + Payroll + Star Performance auto-update
```

### 7.3 Attendance Rules

- **Shift hours**: 9:00 AM – 6:00 PM
- **Late cutoff**: 9:15 AM (15-minute grace period; anyone punching after 9:15 is marked LATE with minute-count stored)
- **Overtime**: any work past 6:00 PM triggers OT tracking on OT check-in / OT check-out punches
- **Sundays**: excluded from working days; Sunday punches are logged but don't contribute to attendance count
- **Holidays**: configured in Holiday Calendar; deducted from monthly working days

### 7.4 Automatic Sync

- Every 2 minutes while the backend is running, the bridge polls the device for new punches
- Idempotent — running twice on the same events produces zero duplicates
- Watermark-based — resumes from the last successful event after a restart
- Read-only — never mutates or clears device storage; the device remains the source of truth

---

## 8. AI-Powered HR Assistant

BVC24 ERP includes a self-hosted AI assistant for HR-related queries. Every AI feature runs on the office server — **no data ever leaves your infrastructure**.

### 8.1 Current Capabilities (Phase 1)

- **Employee chatbot** — natural-language Q&A over HR policy documents (RAG)
- **Leave query bot** — "how many casual leaves do I have left?", "when did I last take sick leave?"
- **Payroll query bot** — "explain last month's salary breakdown"
- **HR policy assistant** — cites the policy document and paragraph for every answer
- **Resume parser** — extracts structured data from PDF resumes (name, skills, experience, education) using Qwen 2.5's JSON mode
- **Onboarding AI service** — assists candidates through the self-registration flow

### 8.2 Technology Choices

| Component | Choice | Notes |
|---|---|---|
| LLM (chat) | **Qwen 2.5 7B Instruct** via Ollama | Multilingual, JSON-mode, ~4.5 GB Q4 quantised |
| LLM (fast fallback) | Phi-3 mini 3.8B via Ollama | Sub-second on CPU |
| Embeddings | nomic-embed-text | Multilingual dense embeddings |
| Vector store | JSON-backed cosine index | Zero infra — file on disk |
| Corpus source | Policy PDFs + DB tables | Auto-indexed on startup |

### 8.3 Voice-First Roadmap (Phases 2–6)

The Software Requirements Specification for the full 30-feature AI HR Assistant lives at `docs/AI_HR_ASSISTANT_SRS.md`. Highlights:

- **Voice-first, text-fallback** interaction — Whisper (STT) + Piper (TTS)
- **Multilingual** — English + Tamil + Hindi with automatic language detection
- **Function-calling agents** — LLM emits structured tool calls (`book_leave`, `get_payslip`, `apply_permission`) with RBAC guards
- **Predictive ML** — attrition risk, attendance anomaly, leave prediction, payroll anomaly (LightGBM / XGBoost)
- **HR Copilot sidebar** — inline "what should I do next?" for managers
- **Speaker verification** — voice-based employee authentication (ECAPA-TDNN)

Full 6-phase roadmap detailed in the SRS document.

---

## 9. Database Design

BVC24 ERP uses a normalised relational schema with 60+ tables, all under a single MySQL database `vending_erp`. Every business table carries a `VENDOR_ID` column for multi-tenant scoping.

### 9.1 Core Table Groups

- **Identity & auth**: `employee`, `role`, `permission`, `role_permission`, `department`, `designation`
- **Attendance**: `attendance`, `attendance_security_log`, `biometric_event`, `geofence_settings`, `holiday_calendar`
- **Leave**: `leave_request`, `leave_balance`, `leave_quota_policy`
- **Payroll**: `salary_structure`, `payroll_run`, `salary_component`, `payslip`
- **Performance**: `monthly_attendance_report`, `performance_score`, `attendance_alert`
- **Task & Project**: `project`, `task_assignment`, `daily_allocation`, `process_stage`, `work_order`, `work_order_stage_progress`
- **Manufacturing**: `product_model`, `bom_item`, `machine`
- **Sales**: `customer`, `quotation`, `sales_order`, `invoice`
- **Purchase**: `supplier`, `purchase_order`, `grn`, `supplier_payment`
- **Onboarding**: `employee_onboarding_session`, `onboarding_checklist_item`, `employee_document`
- **Comms**: `notification`, `memo`, `employee_memo`
- **AI**: `ai_conversation`, `ai_turn`, `ai_tool_call`, `voice_enrollment`, `ml_model_registry`

### 9.2 Referential Integrity

- Foreign keys enforced at the DB layer with `ON DELETE RESTRICT` on most business links
- Auto-migration on backend startup: scans `INFORMATION_SCHEMA` and adds missing columns / drops stale indexes / rebinds broken foreign keys
- Every writable table has `CREATED_AT` and `UPDATED_AT` audit columns

### 9.3 Backup Strategy

- Nightly `mysqldump` (recommended) archived to a network share
- Weekly full-DB snapshot to an external drive
- Point-in-time recovery via MySQL binary log

---

## 10. API Reference — Selected Endpoints

The complete OpenAPI schema is served at `http://<backend>:8001/docs` (Swagger UI). Highlights:

### 10.1 Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin-login` | Admin / HR credentials → JWT |
| POST | `/employee-login` | Employee credentials → JWT |
| POST | `/employee-logout` | Marks logout time |

### 10.2 Attendance

| Method | Path | Purpose |
|---|---|---|
| POST | `/check-in` | Geofenced manual check-in (fallback when biometric unavailable) |
| POST | `/check-out` | Geofenced manual check-out |
| GET | `/attendance` | Filterable history (admin) |
| GET | `/attendance/today` | Today's rows (self for employees, all for admins) |
| GET | `/attendance/my-history` | Own-history (employees) |
| POST | `/biometric/scan` | Device webhook (normalised payload) |

### 10.3 Leave & Permissions

| Method | Path | Purpose |
|---|---|---|
| POST | `/leave/apply` | Submit leave request |
| POST | `/leave/apply-permission` | Submit hourly permission (4h monthly cap) |
| GET | `/leave/balance/{employee_id}` | Current leave balance |
| GET | `/leave/permission-balance/{employee_id}` | Current permission usage |
| PATCH | `/leave/{id}/approve` | Manager approves |

### 10.4 Reports

| Method | Path | Purpose |
|---|---|---|
| GET | `/monthly-reports?year=&month=` | Monthly attendance + payroll |
| POST | `/monthly-reports/generate` | Force recompute for a month |
| GET | `/monthly-reports/{emp_id}/pdf` | Downloadable PDF |
| GET | `/performance/stars?year=&month=` | Star performance scores |

### 10.5 AI

| Method | Path | Purpose |
|---|---|---|
| POST | `/ai-chat` | Natural language query |
| POST | `/leave-brain/*` | Leave-specific reasoning |

Every endpoint is protected by JWT + RBAC. Denied requests return `403` with an audit trail entry.

---

## 11. Security & Compliance

### 11.1 Authentication & Authorisation

- Short-lived JWTs (default 8-hour expiry), rotated via refresh tokens
- Passwords hashed with **bcrypt** (cost factor 12)
- Role-based access control on every route: `Depends(require("permission.name"))`
- SSO-ready hook for SAML / OIDC (roadmap)

### 11.2 Data Protection

| Concern | Control |
|---|---|
| Passwords | bcrypt-hashed, never returned in API responses |
| PII (Aadhaar, PAN, phone) | Masked in audit logs before persistence |
| Salary data | Only visible to `HR_ADMIN` and above; per-employee scope for others |
| Payslip PDFs | Served via authenticated endpoint, never publicly linkable |
| Onboarding invite tokens | UUID-based, single-use, 7-day expiry |

### 11.3 Audit Trail

- Every mutation logged to `attendance_security_log` or the module-specific audit table
- AI conversations recorded in `ai_turn` + `ai_tool_call` with input/output/latency
- Append-only design — no `UPDATE` or `DELETE` on audit tables

### 11.4 On-Premise Guarantee

- Zero calls to external AI APIs — Ollama and all model weights are local
- No cloud storage — files served from local filesystem via authenticated endpoint
- Air-gap ready — the system runs without internet access (only SMTP for email is external)

---

## 12. Deployment

### 12.1 Target Environment

- **Server**: Ubuntu 22.04 LTS (recommended) or Windows Server 2019+
- **Hardware**: 8-core CPU, 32 GB RAM, 500 GB SSD, optional NVIDIA GPU (12 GB VRAM) for larger LLMs
- **Network**: office LAN with static IP for the server (typically `192.168.1.10`)
- **Concurrent capacity**: 50 simultaneous voice sessions or 500 text queries per minute on the recommended hardware

### 12.2 Component Layout

```
Ubuntu server (192.168.1.10)
├── MySQL 8         → :3306 (localhost only)
├── FastAPI (uvicorn) via systemd  → :8001 (behind Nginx)
├── Ollama          → :11434 (localhost only)
├── Nginx           → :80 / :443 (public LAN)
├── /var/www/bvc-erp  → React build served by Nginx
└── /opt/bvc-erp    → application code, .env, virtualenv
```

### 12.3 CI/CD Pipeline (Jenkins)

The `Jenkinsfile` at the repo root defines the pipeline:

```
Stage 1: Checkout      → git clone
Stage 2: Backend       → pip install -r requirements.txt
Stage 3: Frontend      → npm ci && npm run build
Stage 4: Deploy        → rsync to /opt/bvc-erp + /var/www/bvc-erp
Stage 5: Restart       → systemctl restart bvc-backend
```

Every push to `main` triggers a pipeline run. Duration: ~90 seconds.

### 12.4 Environment Variables (`.env`)

Managed via Jenkins credentials store; never committed to Git. Key settings:

```
MY_SQL=mysql+pymysql://erpdbuser:PASSWORD@localhost
DB_NAME=vending_erp
JWT_SECRET_KEY=<long-random>
SMTP_HOST=smtp.gmail.com
SMTP_USER=support@bvc24.com
RESEND_API_KEY=<optional>
ESSL_DEVICE_IP=192.168.1.5
ESSL_COMM_KEY=123456
```

---

## 13. Automated Background Jobs

APScheduler runs three critical background tasks inside the FastAPI process:

| Job | Schedule | Purpose |
|---|---|---|
| `essl-autosync` | Every 2 minutes | Pull new biometric punches from the eSSL X2008 device |
| `star-autosync (boot)` | 30 s after every backend startup | Recompute current month's Star Performance scores |
| `star-autosync (nightly)` | Daily 01:15 IST | Recompute Star Performance using yesterday's finalised attendance |

No manual triggering required. All jobs are idempotent and safely resume after a server restart.

---

## 14. User Roles

The system ships with the following out-of-the-box roles. Additional roles can be created via the RBAC page.

| Role | Access Scope |
|---|---|
| **SUPER_ADMIN** | Everything, including RBAC editing |
| **HR_ADMIN** | Full HR access + read-only elsewhere |
| **MANAGER** | Team-level HR + task management |
| **EMPLOYEE** | Own data only — attendance, leave, payslip, tasks |
| **SALES_EXEC** | CRM + own quotations |
| **PROD_SUPERVISOR** | Manufacturing + task allocation |
| **ADMIN** | System settings + read-only elsewhere |

---

## 15. Employee Self-Service Portal

Every employee lands on the Welcome page after login. Six primary cards (all clickable, no sidebar):

1. **Attendance** — today's punches, working hours, monthly history
2. **Tasks** — assigned tasks with Start / Hold / Done actions
3. **Leave** — apply, track, cancel; balance shown
4. **Permission** — hourly time-off requests (4h monthly cap)
5. **Memo** — company memos and notices
6. **Star Performance** — personal monthly score and dimension breakdown
7. **Payslip** — downloadable monthly PDF

All flows are mobile-responsive and available on the office WiFi via phone.

---

## 16. Manager Dashboards

Managers see additional widgets on the Enterprise Command Center:

- **Team attendance snapshot** — who's in, who's late, who's absent
- **Pending approvals** — leave requests, task acceptances, expense claims
- **Team performance** — Star Performance rollup across direct reports
- **Task Kanban** — drag-and-drop board of team tasks

---

## 17. Admin Runbook

### 17.1 Daily Operations

- Backend uvicorn service runs continuously via `systemd`. Check status: `systemctl status bvc-backend`
- Biometric sync runs automatically every 2 minutes
- Star Performance recomputes at 01:15 daily
- No manual intervention required for routine days

### 17.2 Common Tasks

| Task | Command |
|---|---|
| View live backend logs | `journalctl -u bvc-backend -f` |
| Restart backend | `sudo systemctl restart bvc-backend` |
| Run one-off biometric sync | `python -m app.services.essl_bridge` |
| Bulk import employees from device | `python -m scripts.seed_from_essl --apply` |
| Recompute Star Performance | Auto — via daily job; manual: `python -m scripts.recompute_stars` |
| Backup MySQL | `mysqldump vending_erp \| gzip > backup.sql.gz` |

### 17.3 Troubleshooting Playbook

| Symptom | Investigation |
|---|---|
| Backend won't start | `journalctl -u bvc-backend -n 100` — read the traceback |
| Attendance not syncing | ping the device; check `essl_bridge` logs for network errors |
| Employees showing ₹0 salary | Confirm `salary_structure` row exists; check the Payroll module |
| Monthly report row stuck | Un-lock via SQL: `UPDATE monthly_attendance_report SET STATUS='GENERATED' WHERE …` |
| Star Performance empty | Confirm attendance rows exist for the period; wait for next tick or hit the page |

---

## 18. Testing & Quality

- **Backend tests**: pytest suite covering RBAC, auth, attendance rules, leave calculations, biometric mapping
- **Frontend build**: Vite production build with tree-shaking, minification, and asset hashing
- **Auto-migrations**: verified on startup — no manual schema changes needed after code updates

---

## 19. Roadmap

### 19.1 Immediate (Q3 2026)

- Full voice-first AI HR Assistant (Phases 1-3 of the SRS)
- Predictive ML models for attrition and attendance anomaly
- HR analytics dashboard with natural-language query interface

### 19.2 Medium-term (Q4 2026 – Q1 2027)

- Meeting assistant (record → transcribe → summarise → action items)
- AI career growth advisor with skills graph
- Multi-device biometric support (multiple eSSL / ZKTeco readers)
- Mobile PWA with offline attendance queueing

### 19.3 Long-term

- Multi-tenant SaaS deployment (already scoped in the schema via `VENDOR_ID`)
- SSO integration (SAML / OIDC)
- WhatsApp bot for employee self-service
- Air-gapped deployment package for compliance-sensitive customers

---

## 20. Support & Contact

- **Product owner**: Bharath Vending Corporation
- **Development contact**: BVC24 IT Team
- **Repository**: internal Git (private)
- **Bug reports**: raise via Jenkins issue tracker or email
- **User training**: on-site quarterly refresher sessions

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| RBAC | Role-Based Access Control |
| RAG | Retrieval-Augmented Generation |
| LLM | Large Language Model |
| STT / TTS | Speech-to-Text / Text-to-Speech |
| ORM | Object-Relational Mapper |
| BOM | Bill of Materials |
| GRN | Goods Received Note |
| ESI / PF / PT | Employee State Insurance / Provident Fund / Professional Tax |
| SRS | Software Requirements Specification |
| ADMS | Auto Data Management Service (eSSL push protocol) |

## Appendix B — File Structure

```
Vendor-based Manufacturing ERP/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI entry + auto-migrations
│   │   ├── database/              # DB connection
│   │   ├── models/                # SQLAlchemy models (60+ tables)
│   │   ├── routes/                # HTTP endpoints (grouped by module)
│   │   ├── services/              # Business logic
│   │   └── schemas/               # Pydantic request/response schemas
│   ├── scripts/                   # Migration + one-off tools
│   ├── venv/                      # Python virtual environment
│   ├── requirements.txt
│   └── .env                       # Secrets — never committed
├── frontend/
│   ├── src/
│   │   ├── pages/                 # Route components
│   │   ├── components/            # Reusable UI
│   │   ├── services/api.js        # Axios client
│   │   ├── utils/                 # Shared helpers
│   │   └── App.jsx
│   ├── public/
│   ├── package.json
│   └── vite.config.js
├── docs/                          # This file lives here
├── Jenkinsfile                    # CI/CD pipeline
└── README.md
```

---

*End of document. Prepared for Bharath Vending Corporation, 10 July 2026.*
