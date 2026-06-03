# API — 14 Misc & Integrations

Covers: notifications, WhatsApp, chatbot, HR assistant, 360° views, reports, analytics, settings, seeds.

## Notifications

| Method | Path | Purpose |
|---|---|---|
| POST | `/notifications/create-notification` | Manual create `{ TITLE, MESSAGE, TYPE, EMPLOYEE_ID? }` |
| GET | `/notifications` | List (paginated) |
| GET | `/notifications/unread-count` | Badge count |
| PUT | `/notifications/{id}/read` | Mark single |
| PUT | `/notifications/mark-all-read` | Mark all |
| DELETE | `/notifications/{id}` | Remove |
| POST | `/notifications/generate` | System auto-generate (used internally) |

## WhatsApp

| Method | Path | Purpose |
|---|---|---|
| GET | `/whatsapp/diagnose` | Check integration (CallMeBot / Cloud API config) |
| POST | `/whatsapp/test` | Send test message `{ TO: "+91...", MESSAGE: "..." }` |

## General Chatbot (Gemini)

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | Single-turn `{ MESSAGES: [...] }` |
| POST | `/chat/stream` | Streaming response |
| GET | `/chat/health` | Status + model + configured flag |
| GET | `/chat/suggestions` | Suggested queries |

## HR Assistant (rule-based)

| Method | Path | Purpose |
|---|---|---|
| POST | `/hr-bot/message` | Process message `{ MESSAGE, STATE, EMPLOYEE_CODE }` |
| GET | `/hr-bot/policy` | Display leave policy text |
| GET | `/hr-bot/diagnose` | Integration status |

## 360° Connect Views

| Method | Path | Purpose |
|---|---|---|
| GET | `/connect/employee/{id}/360` | Employee + projects + tasks + performance |
| GET | `/connect/project/{id}/360` | Project + customer + tasks + team + WOs |
| GET | `/connect/customer/{id}/360` | Customer + sales + quotations + projects + contacts |
| GET | `/connect/work-order/{id}/360` | WO + product + stages + QC + team |
| GET | `/connect/supplier/{id}/360` | Supplier + POs + GRNs + parts |
| GET | `/connect/workflow/snapshot` | Global workflow snapshot |

## Analytics

| Method | Path | Purpose |
|---|---|---|
| GET | `/analytics/dashboard-stats` | All KPI aggregates in one call |
| GET | `/analytics/chart-data` | Time-series `?range=7d|30d|month` |

## Reports

| Method | Path | Purpose |
|---|---|---|
| GET | `/reports/report/{module}.pdf` | Generate PDF (`module = sales | production | inventory | attendance | payroll | performance | quality`) |
| GET | `/reports/report/{module}.xlsx` | Generate XLSX |

## Settings

| Method | Path | Purpose |
|---|---|---|
| GET | `/settings` | Application settings |
| PUT | `/settings/email-alerts` | Toggle email alerts |
| POST | `/settings/test-email` | Send test email `{ TO }` |

## Seeds (development)

| Method | Path | Purpose |
|---|---|---|
| POST | `/seed-org` | Apply MANUFACTURING org preset |
| POST | `/seed-admin` | Create default admin |
| POST | `/seed-employees` | Seed demo employees |
| POST | `/seed-bvc24` | Full BVC24 demo (catalog + employees + customers + projects) |
| POST | `/seed-materials` | Seed material catalog |
| POST | `/seed-project-templates` | Seed templates |
| POST | `/procurement/reset-and-seed` | Reset procurement |

## Vendor

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-vendor` | Create tenant `{ VENDOR_NAME }` |
| GET | `/vendors` | List vendors |

See [Module 13 — Notifications](../modules/13-notifications.md), [Module 14 — Chatbot](../modules/14-chatbot.md), [Module 15 — Dashboard & Analytics](../modules/15-dashboard-analytics.md).

---

End of API reference. Continue to [Appendix A — Glossary](../appendix/A-glossary.md).
