# 03 — Technology Stack

## 3.1 Backend

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Language | Python | 3.13 | Runtime |
| Web framework | FastAPI | latest | HTTP routing, OpenAPI, dependency injection |
| ASGI server | Uvicorn | latest | Production-grade async server |
| ORM | SQLAlchemy | 2.x | Database access, migrations |
| Database driver | PyMySQL | latest | MySQL connector for SQLAlchemy |
| Validation | Pydantic | v2 | Request / response schema validation |
| Password hashing | bcrypt (`passlib`) | latest | One-way password storage |
| JWT | `python-jose` | latest | Token signing / verification |
| Email — HTTP | Resend API | v1 | Preferred email transport |
| Email — SMTP | `smtplib` (stdlib) | — | Fallback email transport |
| WhatsApp | WhatsApp Business Cloud API + CallMeBot | v22.0 | Outbound WhatsApp |
| Chat | Google Gemini API | v1 | LLM-backed chatbot |
| File uploads | FastAPI `UploadFile` + local disk | — | Photos, BOM images, resumes |

### Backend layout

The `app/` Python package follows the standard FastAPI "routers + services + models + schemas" structure. See [System Architecture §2.2](./02-system-architecture.md#22-backend-layered-structure) for the directory listing.

## 3.2 Frontend

| Dependency | Version | Purpose |
|---|---|---|
| React | ^19.2.6 | UI framework |
| React DOM | ^19.2.6 | DOM rendering |
| React Router DOM | ^7.15.0 | Client-side routing |
| Axios | ^1.16.0 | HTTP client |
| Recharts | ^3.8.1 | Charts (Pie, Bar, Donut) on Dashboard |
| Vite | latest | Dev server, HMR, production bundler |

**No CSS framework**, no UI library (no Material UI, Ant Design, Chakra, Tailwind). The entire visual layer is custom CSS-in-JS with the BVC red palette applied uniformly. This was a deliberate choice to keep the bundle small (~250 KB gzipped) and avoid theme-engine conflicts with the BVC brand.

## 3.3 Database

- **MySQL 8.x** is the only persistent store.
- Character set: `utf8mb4`, collation: `utf8mb4_unicode_ci`.
- All tables include `CREATED_AT` and (where relevant) `UPDATED_AT` columns with `default=datetime.utcnow` defaults set in the ORM.
- Indices: every `*_ID` foreign key has an index; status columns commonly filtered (`Quotation.STATUS`, `SalesOrder.STATUS`, etc.) are indexed.
- Auto-migration on startup applies idempotent schema evolution (see [§3.7 below](#37-auto-migration)).

## 3.4 Third-Party Services

| Service | Used For | Required? | How to obtain |
|---|---|---|---|
| **Resend** | Transactional email | Optional (SMTP is the fallback) | Sign up at resend.com → get API key |
| **SMTP** (any provider) | Email fallback | Yes (one of Resend or SMTP must work) | Gmail App Password, AWS SES, Mailtrap, etc. |
| **WhatsApp Business Cloud API** | MD WhatsApp alerts | Optional | Meta Business → Get Phone Number ID + Permanent Token |
| **CallMeBot** | Free WhatsApp fallback | Optional | callmebot.com → join via WhatsApp → API key |
| **Google Gemini** | General ERP chatbot | Optional | aistudio.google.com → API key |
| **Biometric device** (ZKTeco / eSSL) | Attendance capture | Optional | Push attendance events to `/biometric/scan` |

If a service is not configured, the application gracefully degrades:

- No email key → quotation/SO/PO emails return "no transport configured" message but the workflow continues.
- No WhatsApp credentials → MD alerts log a warning but do not fail the parent operation.
- No Gemini key → chatbot returns a static "configure GEMINI_API_KEY" message but the HR Assistant (rule-based) still works.

## 3.5 Tooling

| Tool | Purpose |
|---|---|
| Git | Source control (current branch: `main`) |
| Node.js + npm | Frontend tooling |
| Python venv (`venv\`) | Backend isolation |
| FastAPI Swagger UI | `http://127.0.0.1:8001/docs` — auto-generated API explorer |
| FastAPI ReDoc | `http://127.0.0.1:8001/redoc` — alternative spec view |

## 3.6 Browser & Device Support

| Surface | Tested on |
|---|---|
| Admin Dashboard | Chrome 130+, Edge 130+ on Windows 10 (1366 × 768 and up) |
| Employee Dashboard | Same as above, plus tablet (responsive grid) |
| Biometric Check-in | Tablet kiosk mode, Chrome |
| Print views | Chrome / Edge print-to-PDF, A4 size |

Internet Explorer is **not supported** (uses ES2020+, Vite output assumes evergreen browsers).

## 3.7 Auto-Migration

The backend applies idempotent schema changes at startup via the `_run_pending_migrations()` block in `app/main.py`. Each entry is a tuple of `(table, column, DDL fragment)` and is wrapped in `IF NOT EXISTS` so re-execution is safe.

Current pending entries cover columns added across phases — see [Appendix C — Environment Variables](./appendix/C-environment-variables.md) and the master file for the complete current list. New evolutions are added to this list rather than to a separate Alembic project.

> **Why no Alembic?** The single-tenant production target and the developer ergonomics (no `alembic revision` ceremony for every column rename) made `IF NOT EXISTS` migrations a pragmatic fit. When a second tenant or more complex schema changes arrive, migration to Alembic is straightforward — the model definitions stay the same.

## 3.8 Dependency Lock

- **Backend**: `requirements.txt` at `backend/requirements.txt` (FastAPI, SQLAlchemy, PyMySQL, passlib[bcrypt], python-jose, etc.).
- **Frontend**: `package-lock.json` committed; `node_modules/` ignored in production but currently versioned for offline dev convenience.

## 3.9 Build Outputs

- **Backend**: deployed by running `uvicorn app.main:app` with no separate build step. Static assets (uploaded photos, BOM images) are served from `backend/app/static/` via FastAPI's `StaticFiles` mount.
- **Frontend**: `npm run build` produces `frontend/dist/` — a static bundle (`index.html` + hashed JS / CSS in `assets/`) that can be served by any web server (Nginx, S3 + CloudFront, etc.).

---

Next: [04 — Installation & Deployment](./04-installation-and-deployment.md)
