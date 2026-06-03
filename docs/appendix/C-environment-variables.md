# Appendix C — Environment Variables

Complete reference for every `os.getenv()` used by the backend. Place in `backend/.env` (gitignored).

## Required

| Variable | Example | Used by |
|---|---|---|
| `MY_SQL` | `localhost:3306` | Database connection string host:port |
| `DB_NAME` | `bvc24` | Database name |
| `SECRET_KEY` | `<32-char random>` | JWT signing — **must be set in production** |
| `ALGORITHM` | `HS256` | JWT algorithm (default `HS256`) |

## Email — One of these blocks

### Resend (preferred)

| Variable | Example |
|---|---|
| `RESEND_API_KEY` | `re_AbCdEfGh1234...` |
| `SMTP_FROM` | `erp@bvc24.in` |
| `SMTP_FROM_NAME` | `BVC24 ERP` |

### SMTP (fallback / dev)

| Variable | Example |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `you@example.com` |
| `SMTP_PASSWORD` | `<app-password>` |
| `SMTP_FROM` | `erp@bvc24.in` |
| `SMTP_FROM_NAME` | `BVC24 ERP` |
| `SMTP_USE_TLS` | `true` |
| `SMTP_USE_SSL` | `false` |

## Approvals / URLs

| Variable | Example | Used by |
|---|---|---|
| `APPROVER_EMAIL` | `md@bvc24.in` | Leave / task approval emails |
| `APPROVER_NAME` | `Managing Director` | Email salutation |
| `APPROVER_PHONE` | `+91...` | SMS / WhatsApp approval (optional) |
| `ADMIN_EMAIL` | `admin@bvc24.in` | Fallback approval contact |
| `FRONTEND_URL` | `https://erp.bvc24.in` | Email link generation |
| `FRONTEND_BASE_URL` | `https://erp.bvc24.in` | Quotation public link base |
| `BACKEND_URL` | `https://erp.bvc24.in/api` | Email approval tokens |

## WhatsApp (optional)

### CallMeBot (free)

| Variable | Example |
|---|---|
| `CALLMEBOT_API_KEY` | `1234567` |
| `MD_WHATSAPP_NUMBER` | `+91...` |

### WhatsApp Business Cloud API (Meta)

| Variable | Example |
|---|---|
| `WHATSAPP_TOKEN` | `EAAQ...` (Permanent token) |
| `WHATSAPP_PHONE_NUMBER_ID` | `123456789...` |
| `WHATSAPP_PHONE_ID` | alternative field name |
| `WHATSAPP_TEMPLATE_NAME` | `hello_world` (default for first messages) |
| `WHATSAPP_TEMPLATE_LANG` | `en_US` |
| `WHATSAPP_USE_FREEFORM` | `true` to use direct text instead of templates |

## SMS / Twilio (optional)

| Variable | Example |
|---|---|
| `SMS_PROVIDER` | `twilio` / `callmebot` / `whatsapp` |
| (Twilio creds when SMS_PROVIDER=twilio) | per Twilio docs |

## Chatbot (Gemini)

| Variable | Example |
|---|---|
| `GEMINI_API_KEY` | `AIzaSy...` |
| `GEMINI_MODEL` | `gemini-1.5-flash` (default) |

## Development overrides

| Variable | Example | Purpose |
|---|---|---|
| `EMAIL_TESTING_OVERRIDE_TO` | `test@example.com` | Redirect all outgoing emails to one address (dev) |

## Sample `.env`

```env
# Database
MY_SQL=localhost:3306
DB_NAME=bvc24

# JWT
SECRET_KEY=replace-me-with-32-random-chars
ALGORITHM=HS256

# Email (Resend)
RESEND_API_KEY=re_xxx
SMTP_FROM=erp@bvc24.in
SMTP_FROM_NAME=BVC24 ERP

# Approver
APPROVER_EMAIL=md@bvc24.in
APPROVER_NAME=Managing Director

# URLs
FRONTEND_URL=https://erp.bvc24.in
FRONTEND_BASE_URL=https://erp.bvc24.in
BACKEND_URL=https://erp.bvc24.in/api

# WhatsApp (CallMeBot - free)
CALLMEBOT_API_KEY=1234567
MD_WHATSAPP_NUMBER=+91XXXXXXXXXX

# Gemini chatbot (optional)
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-1.5-flash
```

---

Next: [Appendix D — Roadmap](./D-roadmap.md)
