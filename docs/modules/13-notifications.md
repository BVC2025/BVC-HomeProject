# Module 13 — Notifications

## 13.1 Purpose

BVC24 delivers business events to humans through four channels:

1. **Email** — quotations, sales orders, purchase orders, GRN, leave approval links.
2. **WhatsApp** — MD alerts on revenue events.
3. **In-app notification** — bell icon in the dashboard.
4. **Voice alerts** — opt-in browser TTS for critical events on the dashboard.

Each channel is implemented by a dedicated service and gracefully degrades when not configured.

## 13.2 Email

### Transport — `email_service.py`

```python
def send_alert_email(subject, html, recipient) -> (bool, message):
    if RESEND_API_KEY:
        return _send_via_resend(...)
    if SMTP_HOST:
        return _send_via_smtp(...)
    return False, "No email transport configured"
```

### Resend (preferred)

- Configured via `RESEND_API_KEY`.
- Uses Resend's HTTP API (faster, no SMTP handshake).
- Default sender: `SMTP_FROM` env var; default name: `SMTP_FROM_NAME`.

### SMTP (fallback)

- Configured via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
- Supports both TLS (`SMTP_USE_TLS`) and SSL (`SMTP_USE_SSL`).
- Works with Gmail App Passwords, AWS SES, Mailtrap (dev), any standard SMTP.

### Email types

| Event | Template highlight |
|---|---|
| Quotation SENT | Customer-facing HTML with CTA → public link |
| Quotation reminder | Resend variant |
| Sales Order CONFIRM (advance request) | Highlighted advance amount + due date box |
| Purchase Order SENT | Supplier-facing with line items + terms |
| GRN rejection notice | Itemised rejection with reasons |
| Leave application | Approver-facing with two single-click decision links |
| Task approval | Approver-facing with two single-click decision links |
| Stage / task assignment notice | Employee-facing |

### Testing email config

```
POST /settings/test-email
{ TO: "test@example.com" }
```

Sends a verification email through whichever transport is configured.

### Dev override

`EMAIL_TESTING_OVERRIDE_TO` env var, when set, redirects all outgoing emails to a single address. Used during development so quotation flows don't accidentally email real customers.

## 13.3 WhatsApp

### Service — `whatsapp_service.py`

Two transports, tried in order:

1. **CallMeBot** (free, requires WhatsApp "join" message + `CALLMEBOT_API_KEY`).
2. **WhatsApp Business Cloud API** (paid, requires `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`).

The MD's number is configured via `MD_WHATSAPP_NUMBER`.

### Function signatures

```python
send_whatsapp(message: str, phone: str = None) -> (bool, message)
notify_md_safe(message: str)   # fire-and-forget, no exception propagation
```

`notify_md_safe` wraps the send in a try/except so a WhatsApp failure cannot block the parent business operation.

### Events that trigger MD WhatsApp

| Event | Endpoint | Message includes |
|---|---|---|
| New customer | `POST /create-customer` | Customer, contact, sales rep |
| New enquiry | `POST /customers/enquiry` | Enquiry summary, customer |
| Quotation → SO conversion | `POST /sales-orders/from-quotation` | SO #, quote #, customer, total |
| SO awaiting advance | `POST /sales-orders/{id}/confirm` | SO #, customer, total, advance amount + due |
| SO auto-confirmed (advance received) | `POST /sales-orders/{id}/payment` | SO #, customer, advance received |

### Diagnostics

```
GET /whatsapp/diagnose
```

Reports which transport is configured, MD number presence, and a small JSON blob of relevant env vars (without leaking the token).

```
POST /whatsapp/test
{ TO: "+91...", MESSAGE: "test from BVC24" }
```

Sends a one-off test message.

## 13.4 In-app Notifications

### Data — `notification` table

| Column | Notes |
|---|---|
| `TITLE`, `MESSAGE`, `TYPE` (`INFO`/`WARNING`/`ERROR`) | |
| `IS_READ` (0/1) | |
| `VENDOR_ID` | |
| `CREATED_AT` | |

### UI — NotificationBell component

Lives in the admin Dashboard top bar:

- Polls `/notifications/unread-count` every 10 seconds.
- Shows an unread badge.
- Clicking opens a dropdown with the latest 20 notifications.
- Each item is clickable → marks as read via `PUT /notifications/{id}/read`.
- "Mark all read" → `PUT /notifications/mark-all-read`.

### Auto-generation

`POST /notifications/generate` is invoked by some workflows (e.g. when an admin approves a leave, a notification is created for the employee).

### Key endpoints

| Endpoint | Purpose |
|---|---|
| `POST /notifications/create-notification` | Manual create |
| `GET /notifications` | List (paginated) |
| `GET /notifications/unread-count` | Badge count |
| `PUT /notifications/{id}/read` | Mark single |
| `PUT /notifications/mark-all-read` | Mark all |
| `DELETE /notifications/{id}` | Remove |
| `POST /notifications/generate` | System-auto |

## 13.5 Voice Alerts (Dashboard)

The admin Dashboard has an **opt-in voice alert** feature for critical events:

- Toggle in the dashboard header (default: off).
- Uses the browser's `SpeechSynthesisUtterance` API — no external service.
- Speaks critical alerts:
  - Out-of-stock material
  - New high-priority enquiry
  - SO confirmed (advance received)
  - Failed QC inspection
  - Failed payment milestone
- Voice configurable: language, rate, pitch (via `localStorage`).

The employee dashboard has a similar toggle for "Today's tasks announcement" — reads out the day's task list when the employee logs in.

## 13.6 Approver Configuration

The approval-link emails (leave, task) are sent to the address in `APPROVER_EMAIL`. This is typically the Managing Director's address in a small business or the relevant Department Head in a larger setup. Future enhancement: per-department approver configuration (currently it's a global env var).

## 13.7 Graceful Degradation

The system is designed to never block a business operation because a notification channel is unavailable:

- Email send returns `(False, reason)` — the parent op continues and writes `LAST_EMAIL_STATUS` for the user to retry from the UI.
- WhatsApp `notify_md_safe()` swallows exceptions — logs a warning, parent op succeeds.
- In-app notifications are best-effort — if the `notification` insert fails, it does not roll back the parent transaction.

This pattern is critical for shop-floor reliability: a missing API key for WhatsApp should never prevent a Sales Order from being confirmed.

---

Next: [Module 14 — Chatbot & HR Assistant](./14-chatbot.md)
