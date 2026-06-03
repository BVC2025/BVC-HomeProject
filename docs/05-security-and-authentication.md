# 05 — Security & Authentication

## 5.1 Authentication Model

BVC24 uses **JWT-based stateless authentication** with a single sign-in flow per user role:

| Role family | Login endpoint | Identity field | Landing page |
|---|---|---|---|
| Admin / MD / HR / Production Head | `POST /admin-login` or `POST /login` | `EMAIL` + password | `/` → `Dashboard` (admin shell) |
| Employee (floor user) | `POST /employee-login` | `EMPLOYEE_CODE` + password | `/` → `EmployeeDashboard` |

### Token lifecycle

1. The client posts credentials over HTTPS.
2. The backend (`auth_service.py`) verifies the password against the bcrypt hash stored in `employee.PASSWORD` or `root_user.PASSWORD`.
3. On success a JWT is signed with `SECRET_KEY` (HS256 by default — see `ALGORITHM` env var):

   ```json
   {
     "sub": "<employee_id>",
     "role": "ADMIN",
     "vendor_id": 1,
     "exp": <unix_timestamp>
   }
   ```

4. The token is returned in the JSON body and the client stores it in `localStorage`.
5. Every subsequent request includes `Authorization: Bearer <token>` (set automatically by `src/services/api.js`).
6. The `auth_bearer.py` dependency validates the token and exposes the decoded claims to the route function.

### Token expiration & refresh

- Tokens carry an `exp` claim (default 7 days from issue).
- A 401 response from any endpoint triggers `services/api.js` to clear `localStorage` and redirect to `/login`.
- There is no refresh-token endpoint in the current release — users re-authenticate after expiry. (Refresh tokens are on the roadmap if session length needs to be longer than a week.)

## 5.2 Password Storage

- Passwords are hashed with **bcrypt** via the `passlib` library (cost factor 12 by default).
- The `Employee.PASSWORD` and `RootUser.PASSWORD` columns store only the bcrypt hash. **No plaintext password is ever persisted.**
- Admin password reset via `PUT /employees/{id}/reset-password` accepts a new password, hashes it, and stores it.
- Employee profile self-submission keeps the existing password — no password change in the profile gate.

## 5.3 Role-Based Access Control (RBAC)

### Roles (current shipped set)

- `SUPER_ADMIN`
- `ADMIN`
- `HR`
- `MANAGER`
- `PRODUCTION_HEAD`
- `SALES`
- `EMPLOYEE` (floor / non-admin)

Roles live in the `role` table and are seeded by `/seed-org`. The system distinguishes **system roles** (`IS_SYSTEM=1` — cannot be deleted) from **custom roles** created per tenant.

### Permissions

The `permission` table holds fine-grained capability codes (e.g., `task.assign`, `employee.delete`, `report.export`). The `role_permission` join table maps roles → permissions. This gives a flexible RBAC model where a custom role can be created without code changes.

### Enforcement points

- **Route-level**: the route file checks the decoded JWT's `role` claim (`if role not in (ADMIN, SUPER_ADMIN, HR): raise HTTPException(403)`).
- **Frontend-level**: admin-only routes are wrapped in `<Protected>` components in `App.jsx`; the sidebar hides items that the current role does not have permission for.

> **Note**: the permission system is **defined** in the schema and the seed (`organization.py:GET /permissions`) but is not yet enforced at every endpoint. Route-level role checks are the current line of defence. Migrating to a permission-check decorator (`@require_permission("task.assign")`) is on the roadmap.

## 5.4 Multi-tenancy

Every tenant-scoped table includes a `VENDOR_ID` column. The pattern:

1. The JWT carries `vendor_id` from login time.
2. Every list and detail query filters `WHERE VENDOR_ID = :vendor_id`.
3. Cross-tenant access is impossible without forging a JWT (which requires the `SECRET_KEY`).

Currently BVC operates as `VENDOR_ID = 1`. Onboarding a second tenant is:

```sql
INSERT INTO vendor (VENDOR_NAME) VALUES ('New Tenant Pvt Ltd');
```

…followed by running the seed endpoints with the new vendor's auth context.

## 5.5 Public Endpoints (No Authentication)

The following endpoints serve unauthenticated users by design:

| Endpoint | Purpose |
|---|---|
| `POST /admin-login`, `POST /login`, `POST /employee-login` | Authentication |
| `GET /q/{token}` | Customer-facing quotation view (token gates access) |
| `POST /q/{token}/respond` | Customer approves or rejects a quote |
| `GET /approve-task?token=...` | Email-link task approval page |
| `GET /reject-task?token=...` | Email-link task rejection page |
| `GET /leave/decide/{token}?action=approve|reject` | Email-link leave approval |
| `POST /biometric/scan` | Biometric device pushes events (consider device-token auth in production) |

Each of these uses a **single-use or scoped token** rather than session authentication:

- Quotation public tokens are stored on the `Quotation` row (`PUBLIC_TOKEN`), are URL-safe, and are unique per quotation.
- Task and leave approval tokens are stored on the source row (`TaskAssignment.APPROVAL_TOKEN`, `LeaveRequest.APPROVAL_TOKEN`) and become inert after the row's `APPROVAL_RESOLVED_AT` is set.

## 5.6 Transport & Storage Security

| Concern | Status |
|---|---|
| TLS in production | Handled by Nginx + Certbot (Let's Encrypt) |
| Database at rest | Standard MySQL data directory permissions; full-disk encryption recommended at the OS level |
| Secrets in source | `.env` is gitignored; `.env.example` documents the keys without values |
| File uploads | Filename UUIDs are generated server-side to prevent path traversal; MIME type validation on the route |
| SQL injection | All queries use SQLAlchemy ORM — parameterised by default |
| XSS | React escapes by default; the only `dangerouslySetInnerHTML` usages are for trusted server-rendered HTML (quotation public view) |
| CSRF | Not currently enforced — the system is API-first with `Authorization` header (not cookie) auth, which makes CSRF an unlikely vector |
| CORS | Configured in `main.py`; production should restrict `allow_origins` to the deployed frontend host |

## 5.7 Audit Trail

Every business-critical entity has an `*_activity` companion table:

- `quotation_activity` — CREATED, SENT, EMAIL_SENT, VIEWED, APPROVED, REJECTED, CONVERTED
- `sales_order_activity` — CREATED, AWAITING_ADVANCE, EMAIL_SENT, CONFIRMED, PROJECTS_SPAWNED, PAYMENT_RECEIVED, SHIPPED, DELIVERED, CLOSED, CANCELLED
- `purchase_order_activity` — CREATED, SENT, CONFIRMED, GRN_RECORDED, RECEIVED, CANCELLED

Each activity row carries:

- `EVENT_TYPE` (string code)
- `EVENT_DETAIL` (free-text)
- `ACTOR_TYPE` (`SYSTEM` / `SALES` / `CUSTOMER` / `SUPPLIER` / `WAREHOUSE` / `ADMIN`)
- `ACTOR_NAME` (optional human name)
- `CREATED_AT`

This gives a tamper-evident timeline ("who did what, when, in their own words") that survives the deletion of the parent record.

## 5.8 Sensitive Data Handling

- **Bank details** in `Employee` (if added) — currently free-text, not encrypted at rest.
- **Customer GST / PAN** — stored as plain strings; treated as sensitive in print views (visible only to admin roles).
- **Salary** in `Employee.SALARY` and the entire `payroll_slip` table are gated to HR / SUPER_ADMIN at the route layer.

## 5.9 Approval Token Security

Approval tokens (`TaskAssignment.APPROVAL_TOKEN`, `LeaveRequest.APPROVAL_TOKEN`) are:

- Generated as 32-character URL-safe random strings (`secrets.token_urlsafe(24)`).
- Stored on the source row and matched on click.
- Considered consumed once `APPROVAL_RESOLVED_AT` is set.
- Subject to a 7-day expiry (cleaned up by `POST /task-proposals/cleanup-expired`).

## 5.10 Security Hardening Checklist for Production

Before going live with a real customer:

- [ ] Set `SECRET_KEY` to a 32+ character random value (not the dev default).
- [ ] Restrict CORS `allow_origins` in `main.py` to the deployed frontend host(s).
- [ ] Gate seed endpoints (`/seed-*`, `/procurement/reset-and-seed`) behind a production guard.
- [ ] Force HTTPS at Nginx (`return 301 https://$host$request_uri;` for port 80).
- [ ] Enable MySQL TLS for app → DB connection if they live on separate hosts.
- [ ] Configure offsite database backups.
- [ ] Configure log shipping (`uvicorn` → systemd journal → ELK / CloudWatch).
- [ ] Add rate limiting on `/admin-login` and `/employee-login` to prevent credential stuffing.
- [ ] Subscribe to dependency security advisories (`npm audit`, `pip-audit`).

---

Next: [06 — Database Schema](./06-database-schema.md)
