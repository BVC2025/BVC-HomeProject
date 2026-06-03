# Appendix D — Roadmap

## D.1 Status

| Phase | Module Areas | Status |
|---|---|---|
| 1 | Organization · IAM · Employees · Profile · Biometric | ✅ Complete |
| 2 | Attendance · Leave · Payroll · STAR Performance | ✅ Complete |
| 3 | CRM · Customers · Quotations (with public link) | ✅ Complete |
| 4 | Procurement · Suppliers · Purchase Orders · GRN | ✅ Complete |
| 5 | Sales Orders (payment-gated) · Project auto-spawn | ✅ Complete |
| — | Production · BOM · Work Orders · Gantt · Quality · Machines | ✅ Complete |
| — | Notifications · WhatsApp · Email · Chatbot | ✅ Complete |
| — | Dashboard · Analytics · Reports | ✅ Complete |
| 6 | **Invoicing · GST e-Invoice · e-Way Bill** | ⏳ Planned |
| 7 | **Service / AMC · Complaint tickets · Service visits** | ⏳ Planned |

## D.2 Phase 6 — Invoicing (planned)

Triggered after a Sales Order reaches `DELIVERED` (or `DISPATCH` payment milestone for advance billing). Scope:

- **Tax Invoice** generation per SO, per shipment.
- **e-Invoice IRN** via GSTN sandbox / production.
- **e-Way Bill** generation for shipments > ₹50,000.
- **Credit / Debit Notes** for returns and adjustments.
- **TCS / TDS** handling for B2B customers.
- **Payment reconciliation** dashboard.

### New entities (planned)

- `Invoice` (header, IRN, e-way bill number, status)
- `InvoiceLine` (mirrors SO line at the time of billing)
- `CreditNote` / `DebitNote`
- `PaymentReceipt` (replaces the current milestone columns on SO)

## D.3 Phase 7 — Service & AMC (planned)

Triggered after a Machine has been deployed at a customer site. Scope:

- **AMC Contract** entity per customer per machine (start date, term, value, payment schedule).
- **Complaint Ticket** workflow (open → assigned → in-progress → resolved).
- **Service Visit** scheduling and engineer dispatch.
- **Spare Parts** consumption against ticket.
- **Renewal reminders** before AMC expiry.

### New entities (planned)

- `AMCContract`
- `ComplaintTicket`
- `ServiceVisit`
- `ServicePartUsage`

## D.4 Cross-cutting Roadmap Items

| Item | Why |
|---|---|
| **Alembic migrations** | Replace ad-hoc `IF NOT EXISTS` block with versioned migrations once schema changes get more complex. |
| **Per-permission enforcement** | Move from role-based checks to `@require_permission()` decorators across all routes. |
| **Refresh tokens** | Extend session beyond 7 days without forcing re-login. |
| **Rate limiting** | Add on login endpoints (current vector: credential stuffing). |
| **Background jobs (Celery + Redis)** | Heavy reports, batch emails, bulk PO send. |
| **Materialised summary tables** | Speed up dashboard queries at higher load. |
| **Mobile app** | React Native shell sharing API; sales rep on-field quotation creation. |
| **Tamil + Hindi UI** | Phase 1 string extraction is done; need translations. |
| **Per-department approver** | Currently `APPROVER_EMAIL` is global; should be configurable per department. |
| **WebSocket layer** | When dashboard polling becomes a bottleneck. |
| **Knowledge-base chatbot (RAG)** | Feed the Gemini bot this `/docs` folder as retrieval context. |
| **PDF attachment variant** | Some customers prefer attachments over public links — add toggle per customer. |
| **GST invoice PDF compliance** | Layout per GSTN spec including QR code with IRN. |
| **Multi-currency** | When BVC expands beyond India. |
| **Audit log table** | Centralise `*_activity` patterns into a single `audit_log` with FK type discriminator. |

## D.5 Known Gaps in Current Release

| Gap | Workaround / Impact |
|---|---|
| Seed endpoints are not gated by environment | Should be disabled in production. Currently relies on operational discipline. |
| Permissions are defined but not enforced per endpoint | Role-level enforcement is in place — sufficient for current need. |
| Stock movement audit table is not separate | Movements are derived from GRN finalisations and adjustment notes. |
| Refresh-token endpoint absent | Users re-login every 7 days. |
| No rate limiting on `/admin-login` | Vulnerable to credential stuffing — add nginx or app-level limit. |
| Approval token expiry not auto-cleaned | `POST /task-proposals/cleanup-expired` exists but is not on a cron yet. |
| Email queue is synchronous | Slow SMTP delays API response; move to background. |
| File uploads have no virus scanning | Acceptable for trusted internal users; revisit when opening uploads to customers. |
| Phase 6 (Invoicing) not implemented | Customer invoicing relies on external accounting today. |
| Phase 7 (AMC / Service) not implemented | Service is tracked manually via WhatsApp / spreadsheets today. |

---

Next: [Appendix E — Changelog](./E-changelog.md)
