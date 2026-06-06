# BVC24 — Employee Module

**Deployment-grade reference for the employee portal, attendance, leave, memos, documents, performance, and the floating ERP assistant.**

> Audience: HR managers, system administrators, IT operations, support staff, and developers extending the module.
> Companion document: [docs/modules/02-hr.md](./modules/02-hr.md) covers the admin/HR side of the same data. This document focuses on the **employee-facing experience** and **production deployment**.

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Architecture & Code Map](#2-architecture--code-map)
3. [Roles & Access Matrix](#3-roles--access-matrix)
4. [Lifecycle: From Onboarding to Daily Use](#4-lifecycle-from-onboarding-to-daily-use)
5. [Authentication & Session](#5-authentication--session)
6. [Employee Portal — Section-by-Section](#6-employee-portal--section-by-section)
7. [Attendance & Geofencing](#7-attendance--geofencing)
8. [Leave & Permissions](#8-leave--permissions)
9. [Tasks & Productivity](#9-tasks--productivity)
10. [Memos & Acknowledgement](#10-memos--acknowledgement)
11. [Employee Documents](#11-employee-documents)
12. [Performance, Productivity & Rewards](#12-performance-productivity--rewards)
13. [The Floating ERP Assistant (Chatbot)](#13-the-floating-erp-assistant-chatbot)
14. [Employee API Reference](#14-employee-api-reference)
15. [Notifications & Email](#15-notifications--email)
16. [Production Deployment Checklist](#16-production-deployment-checklist)
17. [Security Considerations](#17-security-considerations)
18. [Troubleshooting Runbook](#18-troubleshooting-runbook)
19. [HR / Admin Operational Tasks](#19-hr--admin-operational-tasks)
20. [Extending the Module](#20-extending-the-module)
21. [Appendix A — localStorage Keys](#appendix-a--localstorage-keys)
22. [Appendix B — State Transitions](#appendix-b--state-transitions)
23. [Appendix C — Quick Reference for Employees](#appendix-c--quick-reference-for-employees)

---

## 1. Module Overview

The Employee Module is the part of BVC24 that every shop-floor worker, supervisor and HR officer touches every day. It bundles:

| Sub-module | Employee can | HR can |
|---|---|---|
| **Login** | Sign in with EMPLOYEE_CODE + password | Create accounts, reset passwords |
| **Profile** | Complete one-time self-registration form, upload photo | Edit any field, view full profile |
| **Attendance** | Check in / check out (web or biometric kiosk) with geofence validation | View full ledger, mark absent, audit GPS failures |
| **Tasks** | Accept/reject assignments, mark progress (Pending → In Progress → Completed), put on hold | Assign tasks (manual or auto), track workload, view performance |
| **Leave** | Apply for day-leave or hourly permission, view balance, cancel pending requests | Approve via emailed link (1-click), reject with reason, view all requests |
| **Memos** | Read & acknowledge memos (warnings, appreciations, disciplinary notices) | Issue memos, attach files, close/cancel, export to CSV |
| **Documents** | View own documents (read-only) | Upload identity proofs, certificates, offer letters |
| **Performance** | See own score, productivity chart, ratings, rewards (points, streak, badge) | See company-wide performance, suggested increments |
| **Chatbot** | Multi-turn leave application, check status, ask any ERP question | Same — plus HR-wide overviews (pending approvals, on-leave-today) |

**Design principle:** the portal is **read-mostly + structured-write**. Employees never directly edit core records (department, designation, salary, role). They request changes; HR approves.

---

## 2. Architecture & Code Map

### 2.1 Frontend (React 19 + Vite)

```
frontend/src/
├── App.jsx                          # Routing + ProtectedRoute + RoleBasedLanding
├── pages/
│   ├── Login.jsx                    # Admin / Employee tabbed login
│   ├── EmployeeDashboard.jsx        # Main portal (role="employee" landing)
│   ├── EmployeeProfileForm.jsx      # One-shot self-registration gate
│   ├── EmployeeMemos.jsx            # Memo viewer (scoped to current employee)
│   ├── EmployeeOnboardingChat.jsx   # Public token-gated onboarding flow
│   ├── ApplyLeave.jsx               # Standalone leave application page
│   ├── BiometricCheckIn.jsx         # Kiosk page (public, no auth)
│   └── Attendance.jsx               # Read-mostly attendance view
├── components/
│   ├── ChatBot.jsx                  # Floating ERP Assistant (SSE streaming)
│   └── GeofenceGate.jsx             # GPS-based attendance gate
└── services/
    └── api.js                       # Axios instance + same-host autodiscovery
```

### 2.2 Backend (FastAPI + SQLAlchemy + MySQL)

```
backend/app/routes/
├── connect.py               # /admin-login, /employee-login, /employee-logout
├── employee.py              # CRUD + photo + reset-password
├── employee_portal.py       # /employee/{id}/portal-dashboard (one-shot)
├── employee_task.py         # task accept/reject/status, today-task, all-tasks
├── employee_documents.py    # documents CRUD
├── employee_memos.py        # memos CRUD + acknowledge + CSV export
├── employee_onboarding.py   # token-gated public onboarding chat
├── attendance.py            # /check-in, /check-out, /attendance/*
├── leave.py                 # /leave/apply, /balance, /my-requests, /apply-permission, /cancel, /decide
├── geofence.py              # /geofence/settings, /validate, /log-failure, /security-logs
└── chatbot.py               # /chat/stream (SSE) + leave bridge

backend/app/services/
├── leave_chatbot_service.py  # Multi-turn leave NLU + slot filling
├── payroll_service.py        # Monthly slip generation
└── performance_service.py    # Star rating + increment %

backend/app/models/models.py  # SQLAlchemy ORM definitions
```

### 2.3 Database Tables

| Table | Anchored to | Notes |
|---|---|---|
| `employee` | — | Master record. `PROFILE_SUBMITTED` gates the self-reg form |
| `attendance` | employee | One row per employee per day. `CHECK_IN`, `CHECK_OUT`, `STATUS`, `GEOFENCE_*` |
| `leave_request` | employee | All leaves + permissions. `STATUS` ∈ {PENDING_APPROVAL, APPROVED, REJECTED, CANCELLED} |
| `leave_balance` | employee | Yearly CASUAL / SICK / EARNED / MATERNITY quotas |
| `task_assignment` | employee + project | Assigned work. `TASK_STATUS`, `APPROVAL_STATUS` |
| `employee_memo` | employee | Warnings, appreciations, disciplinary. Soft-deletable |
| `employee_document` | employee | Identity, education, offer letter — file references |
| `biometric_event` | employee (via FINGERPRINT_ID) | Raw scans, audit log |
| `notification` | employee | In-app inbox |
| `geofence_settings` | vendor | Per-vendor office centre + radius |
| `attendance_security_log` | employee (nullable) | Failed GPS / geofence attempts |

---

## 3. Roles & Access Matrix

The system has **two top-level roles** stored in `localStorage.role`: `"admin"` and `"employee"`. The landing route `/` dispatches via [App.jsx:44](frontend/src/App.jsx#L44) → `RoleBasedLanding()`.

| Action | Employee | HR / Admin |
|---|:---:|:---:|
| View own dashboard | ✅ | — (admins see Dashboard.jsx) |
| Edit own profile (one-shot self-reg) | ✅ | ✅ (anytime via Employees page) |
| Change own department / role / salary | ❌ | ✅ |
| Check in / check out | ✅ | ✅ (any employee) |
| View own attendance | ✅ | ✅ (all) |
| Apply for leave / permission | ✅ | ✅ (on behalf of any employee) |
| Cancel own pending leave | ✅ | ✅ |
| Approve / reject leave | ❌ | ✅ (via emailed token link, 1-click) |
| Accept / reject task assignment | ✅ | — |
| Mark task IN_PROGRESS / COMPLETED / ON_HOLD | ✅ (own tasks) | ✅ (any) |
| Issue / edit / close memos | ❌ | ✅ |
| Acknowledge memo | ✅ (own only) | ✅ |
| Upload own documents | ❌ | ✅ (uploads on employee's behalf) |
| View own documents | ✅ | ✅ |
| View own performance | ✅ | ✅ (all) |
| View company performance | ❌ | ✅ |
| Use floating chatbot | ✅ | ✅ |
| Multi-turn leave via chatbot | ✅ (auto-fills self) | ✅ |
| Use HR-wide chatbot queries | ✅ (read-only) | ✅ |

> **Important:** Most backend endpoints do **not** enforce JWT yet — the access matrix is largely **frontend-driven**. The login flow stamps `role` into localStorage, and the UI only renders employee-appropriate controls. See [§17 Security Considerations](#17-security-considerations) for hardening recommendations before public deployment.

---

## 4. Lifecycle: From Onboarding to Daily Use

### 4.1 Account Creation (HR action — once per employee)

```
HR opens   Dashboard → Employees → Add Employee
HR fills   EMPLOYEE_CODE, NAME, EMAIL, PHONE, PASSWORD,
           DEPARTMENT, DESIGNATION, ROLE, JOINING_DATE,
           SALARY, SHIFT_START / END
Backend    POST /create-employee
           - bcrypt-hashes PASSWORD
           - sets PROFILE_SUBMITTED = 0
HR shares  EMPLOYEE_CODE + initial password with the employee
           (in-person, SMS, or secure channel)
```

### 4.2 First Login (Employee action — once)

```
1.  Employee opens https://<your-host>:5173/login
2.  Selects "Employee" tab → enters EMPLOYEE_CODE + password
3.  Backend POST /employee-login validates, returns:
      - JWT token
      - EMPLOYEE_ID, EMPLOYEE_NAME, DEPARTMENT
      - ATTENDANCE_STATUS, HAS_PENDING_FROM_YESTERDAY
      - Side-effect: creates today's Attendance row (CHECK_IN)
4.  Frontend stamps localStorage:
      auth=true, role=employee, token=<jwt>,
      employee_id=<UUID>, employee_name=...
5.  / route loads EmployeeDashboard.jsx
6.  Dashboard hits GET /employees/by-code/{code}
      - If PROFILE_SUBMITTED=0  → renders EmployeeProfileForm
      - If PROFILE_SUBMITTED=1  → renders full dashboard
7.  Employee fills 7-section form, optionally uploads photo
8.  POST /employees/by-code/{code}/submit-profile
      - Flips PROFILE_SUBMITTED = 1
      - Admin-gated fields (ROLE_ID, SALARY) silently dropped
9.  Dashboard re-renders in normal mode
```

### 4.3 Daily Use

```
Morning
  Login → automatic check-in stamped
  Geofence validated (if enforcement ACTIVE) — see §7
  System computes STATUS: PRESENT / LATE
  If LATE: auto-creates LATE_COMING Permission row

Throughout day
  View "Today's Tasks" → click Start Task → IN_PROGRESS
  Complete task → award points, unlock next stage
  Apply for leave via inline form OR chatbot
  Read & acknowledge memos
  Ask chatbot for status, balances, anything

Evening
  Click "Logout" or close tab
  POST /employee-logout stamps CHECK_OUT
  Computes WORKED_HOURS + OVERTIME_HOURS
  If left early: auto-creates EARLY_EXIT Permission
```

### 4.4 Self-Onboarding Variant (Token-Gated)

For new hires who haven't been physically onboarded yet:

```
HR creates onboarding token (admin flow generates URL)
HR emails: https://<host>:5173/employee-onboarding/<token>
Employee opens link (public, no login)
EmployeeOnboardingChat collects: name, email, phone, address,
                                 education, experience, skills
On submit → creates employee record with default password
Employee then proceeds to normal login flow
```

---

## 5. Authentication & Session

### 5.1 Login Endpoints

| Endpoint | Used by | Auth | Response |
|---|---|---|---|
| `POST /admin-login` | Admin tab | EMAIL or USERNAME + PASSWORD | token, role, permissions |
| `POST /employee-login` | Employee tab | EMPLOYEE_CODE or UUID + PASSWORD | token, EMPLOYEE_ID, name, department, attendance_status |
| `POST /employee-onboarding/{token}/login` | Onboarding flow | token + DOB or PHONE | scoped session |
| `POST /employee-logout` | Employee | JWT (current session) | check-out stamped |

### 5.2 Session Storage

After successful login, the frontend stamps `localStorage`:

| Key | Set by | Read by |
|---|---|---|
| `auth` | Login | `ProtectedRoute` |
| `role` | Login | `RoleBasedLanding`, sidebar filter |
| `token` | Login | Axios request interceptor (Bearer) |
| `employee_id` | Employee login | Dashboard, ChatBot, ApplyLeave |
| `employee_name` | Employee login | Dashboard greeting, profile card |
| `department` | Employee login | Profile card |
| `employee_role` | Employee login | Profile card (e.g. "Operator", "Supervisor") |
| `loginTime` | Employee login | Session age display |
| `attendance_status` | Employee login | "Already checked in" indicator |
| `pending_yesterday` | Employee login | Carry-over task banner |
| `chatbot_leave_state_{employee_id}` | ChatBot leave flow | Per-employee multi-turn state |

### 5.3 401 Handling

`API.interceptors.response` in [api.js:54](frontend/src/services/api.js#L54) intercepts 401:
- `localStorage.clear()`
- if role was `employee` → redirect to `/login`

### 5.4 Backend Host Auto-Discovery

[api.js:16](frontend/src/services/api.js#L16) auto-detects the backend:

1. `VITE_API_URL` env var (production override)
2. Same-host autodetection: `${proto}//${window.location.hostname}:8001`
3. Hardcoded `http://127.0.0.1:8001` fallback

This means a phone on `192.168.1.20` hitting `http://192.168.1.56:5174` automatically targets `http://192.168.1.56:8001` — no code change needed.

---

## 6. Employee Portal — Section-by-Section

The portal at [EmployeeDashboard.jsx](frontend/src/pages/EmployeeDashboard.jsx) is one continuous scrolling page. Sections (top to bottom):

### 6.1 Profile Card
Photo (or initials avatar), name, EMPLOYEE_CODE, performance rating (★/5), productivity badge. Click photo to upload.

### 6.2 KPI Grid (8 tiles)
`Total Tasks · Today · Pending · In Progress · On Hold · Completed · Upcoming · Overdue`

### 6.3 Today's Tasks (sticky)
Shows tasks due today. Action buttons:
- **Start Task** → status → `IN_PROGRESS`, stamps `START_TIME`
- **Complete** → status → `COMPLETED`, stamps `END_TIME`, awards points, unlocks next stage
- **Hold** → status → `ON_HOLD`

### 6.4 Tabbed Task List
Pending · In Progress · On Hold · Upcoming · Completed (each tab shows count).

### 6.5 Assigned Projects Grid
Cards per project with progress bars per stage (from `WorkOrderStageProgress`).

### 6.6 Performance Breakdown
8 metrics with horizontal bars:
- On-time delivery %, Quality score, Attendance %, Task completion rate,
  Average completion time, Stage-flow efficiency, Memo-impact score, Final composite

### 6.7 Productivity Chart
6-month line chart of tasks completed per month (Recharts).

### 6.8 Attendance Summary
4 tiles: Present · Absent · On Leave · Permissions Used · Monthly % bar.

### 6.9 Rewards
Points balance, current streak (consecutive days punctual), badge (Bronze/Silver/Gold/Platinum).

### 6.10 My Memos
List of memos issued to the employee. Each unacknowledged memo has an "Acknowledge" button → modal with optional remark → `POST /memos/{id}/acknowledge`.

### 6.11 Leave & Permission (inline forms)
Quick-apply forms below the dashboard, also accessible via chatbot.

### 6.12 Floating Chatbot
Bottom-right red bubble. Click to open the ERP Assistant panel — see [§13](#13-the-floating-erp-assistant-chatbot).

---

## 7. Attendance & Geofencing

### 7.1 Three Check-In Channels

| Channel | Path | How |
|---|---|---|
| **Web login** | `POST /employee-login` | Automatic on successful login (creates Attendance row) |
| **Web check-in** | `POST /check-in` | Manual button on Attendance page (with GPS) |
| **Biometric kiosk** | `POST /biometric/scan` | Tablet at entrance + fingerprint reader |

### 7.2 Geofence Enforcement

`GeofenceSettings` table holds the office centre lat/lng + radius. Flow:

```
1.  Page mounts → GeofenceGate calls GET /geofence/settings
2.  If IS_ACTIVE=false  → bypass; allow check-in from anywhere
3.  If IS_ACTIVE=true   → browser navigator.geolocation.getCurrentPosition()
       - Success → POST /geofence/validate with lat/lng
                 → if allowed: enable check-in button
                 → if not    : show "Outside Office Geofence (3.2km)"
       - Denied / unavailable / timeout
                 → show error + "Skip GPS" button
                 → POST /geofence/log-failure (security audit)
                 → Status logged as GEOFENCE_STATUS=UNKNOWN
```

### 7.3 What Gets Stamped

Every successful check-in fills these `attendance` columns:
- `CHECK_IN`, `STATUS` (PRESENT / LATE), `LATITUDE`, `LONGITUDE`,
  `DISTANCE_METERS`, `GEOFENCE_STATUS`, `DEVICE_INFO`, `BROWSER_INFO`

Every check-out fills:
- `CHECK_OUT`, `WORKED_HOURS`, `OVERTIME_HOURS`, `CHECKOUT_DISTANCE_METERS`

### 7.4 LATE / EARLY_EXIT Auto-Permissions

If check-in is past `SHIFT_START + grace`, the system silently creates a `LEAVE_TYPE=PERMISSION, SUBTYPE=LATE_COMING` row for HR review. Same for early checkout → `EARLY_EXIT`. No quota deduction; just an audit trail and a notification.

### 7.5 Mobile Testing Setup

For testing geofence from a real phone on the same Wi-Fi (very common deploy scenario):

1. **Backend** must bind to `0.0.0.0`:
   ```powershell
   uvicorn app.main:app --host 0.0.0.0 --port 8001
   ```
2. **Frontend** must bind to `0.0.0.0`:
   ```powershell
   npm run dev -- --host 0.0.0.0
   ```
3. **Windows Firewall** must allow inbound on 8001 + 5173/5174 (run once as Admin):
   ```powershell
   New-NetFirewallRule -DisplayName "BVC24 Backend"  -Direction Inbound -LocalPort 8001 -Protocol TCP -Action Allow
   New-NetFirewallRule -DisplayName "BVC24 Frontend" -Direction Inbound -LocalPort 5173,5174 -Protocol TCP -Action Allow
   ```
4. **Phone connects** to `http://<PC-LAN-IP>:5174` (e.g. `http://192.168.1.56:5174`)
5. **HTTPS for GPS**: Mobile browsers require a **secure context** (HTTPS) for `navigator.geolocation` on most devices. For LAN testing, Chrome accepts `localhost` over HTTP, but a phone hitting `http://192.168.1.56:5174` may have GPS blocked. Two options:
   - **Add an HTTPS reverse proxy** (Caddy, nginx with self-signed cert) — recommended for any production use.
   - **For trusted LAN dev only:** open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` on the phone and add the LAN URL.

### 7.6 Daily Cron — Mark Absent

A scheduled job should run at end-of-day (e.g. 23:55) to:
```
For each ACTIVE employee with no Attendance row today:
  Insert Attendance(EMPLOYEE_ID, DATE, STATUS=ABSENT)
```
This is not yet automated by default — see [§16.7](#167-cron--scheduled-jobs) for the deployment task.

---

## 8. Leave & Permissions

### 8.1 Leave Types

| Type | Quota-backed | Half-day allowed | Gender-gated |
|---|:---:|:---:|---|
| `CASUAL` | ✅ | ✅ | — |
| `SICK` | ✅ | ✅ | — |
| `EARNED` | ✅ | ✅ | — |
| `MATERNITY` | ✅ | ❌ | FEMALE only |
| `UNPAID` | ❌ | ✅ | — |
| `LOP` (Loss of Pay) | ❌ | ✅ | — |
| `PERMISSION` | ❌ | n/a (hourly) | — |

Defaults defined in [leave.py](backend/app/routes/leave.py) `QUOTA_BACKED_TYPES` and per-employee balances in the `leave_balance` table.

### 8.2 Apply for Day-Leave

Three channels — same backend:

1. **Inline form** on [EmployeeDashboard.jsx](frontend/src/pages/EmployeeDashboard.jsx)
2. **Standalone page** at `/apply-leave` ([ApplyLeave.jsx](frontend/src/pages/ApplyLeave.jsx))
3. **Chatbot** — multi-turn conversation, see [§13.2](#132-leave-multi-turn-workflow)

All hit `POST /leave/apply`:

```json
{
  "EMPLOYEE_ID": "<uuid or code>",
  "LEAVE_TYPE":  "CASUAL",
  "START_DATE":  "2026-06-15",
  "END_DATE":    "2026-06-16",
  "HALF_DAY":    false,
  "REASON":      "Family function",
  "VENDOR_ID":   1
}
```

Validations:
- Quota check (for quota-backed types)
- Overlap check (against existing PENDING / APPROVED)
- `START_DATE ≤ END_DATE`
- `HALF_DAY` only valid for single-date requests
- `MATERNITY` requires `GENDER=FEMALE`
- Every leave needs a non-empty `REASON`

### 8.3 Manager Approval (Email-Driven)

```
1. /leave/apply creates LeaveRequest with STATUS=PENDING_APPROVAL
2. Backend generates APPROVAL_TOKEN (signed, single-use)
3. Backend sends email to APPROVER (department head, or fallback)
   Subject: "Leave request from <Employee> — <Dates>"
   Body:    [Approve ✓]   [Reject ✗]   buttons (HTML links)
4. Approver clicks Approve link
   → GET /leave/decide/{token}?action=approve
   → Validates token, flips STATUS=APPROVED, stamps APPROVAL_RESOLVED_AT
   → Deducts quota (if quota-backed)
   → Sends decision email back to employee
   → Pushes in-app notification
   → Renders styled HTML success page
```

> No approver login required — the emailed link is the credential. Tokens are single-use and expire on first click.

### 8.4 Hourly Permissions

Different endpoint, different shape:

```
POST /leave/apply-permission
{
  "EMPLOYEE_ID":        "<uuid>",
  "PERMISSION_DATE":    "2026-06-15",
  "DURATION_HOURS":     2.5,
  "PERMISSION_SUBTYPE": "SHORT_PERMISSION",
  "REASON":             "Doctor appointment"
}
```

Subtypes: `SHORT_PERMISSION`, `HALF_DAY`, `LATE_COMING`, `EARLY_EXIT`.

Permissions create a LeaveRequest with `LEAVE_TYPE=PERMISSION, DAYS=0`. No quota deduction. Manager approval flow identical.

### 8.5 Cancel

```
PATCH /leave/{leave_id}/cancel
{ "EMPLOYEE_ID": "<uuid or code>", "NOTES": "Plans changed" }
```

If status was `APPROVED` → refunds the quota. Ownership is checked (employee can only cancel own leaves; admins can cancel any).

### 8.6 Balances & History

| Endpoint | Returns |
|---|---|
| `GET /leave/balance/{employee_id}?year=2026` | `{ CASUAL {total, used, remaining}, SICK, EARNED }` |
| `GET /leave/my-requests?employee_id=<id>` | All leave requests (newest first) |
| `GET /leave/my-permissions?employee_id=<id>` | PERMISSION rows only |
| `GET /leave/dashboard-summary/{employee_id}` | KPI counts for portal cards |

---

## 9. Tasks & Productivity

### 9.1 Assignment Flow

```
HR / Manager  POST /task-assignment
              { EMPLOYEE_ID, PROJECT_ID, TASK_NAME, DUE_DATE, AUTO_ASSIGN }
              - if AUTO_ASSIGN=true → load-balancer picks best available employee
              - Creates TaskAssignment with APPROVAL_STATUS=PENDING
              - Emails assignee
              - Pushes notification

Employee      Sees task in "Pending Acceptance" section
              PATCH /task-assignment/{id}/accept  → APPROVAL_STATUS=APPROVED
              PATCH /task-assignment/{id}/reject  → APPROVAL_STATUS=REJECTED
                                                    → may auto-reassign to next-best
```

### 9.2 Status Transitions

```
PENDING  ──(Start Task)──▶  IN_PROGRESS  ──(Complete)──▶  COMPLETED
                                  │
                                  └──(Hold)──▶  ON_HOLD  ──(Resume)──▶  IN_PROGRESS
```

Endpoint:
```
PATCH /employee/{employee_id}/tasks/{assignment_id}/status
{ "status": "IN_PROGRESS" }
```

Side effects:
- Stamps `START_TIME` (on IN_PROGRESS), `END_TIME` (on COMPLETED)
- Awards points (configurable per-task or default)
- Updates `WorkOrderStageProgress` if task is stage-linked
- Re-computes employee performance score
- Returns `{ message, new_status, points_awarded, on_time, unlock_result }`

### 9.3 Points & Rewards

Points awarded per task completion:
- Base: 10 points
- On-time bonus: +5
- Streak multiplier: ×1.0 → ×1.5 (resets on missed day)

Badges:
- **Bronze** ≥ 100 pts
- **Silver** ≥ 500 pts
- **Gold** ≥ 1500 pts
- **Platinum** ≥ 5000 pts

(Thresholds defined in performance_service.py; tune for your org.)

---

## 10. Memos & Acknowledgement

### 10.1 What Memos Are For

Memos are HR's structured audit trail for behavioural events:

| Type | Severity | Example |
|---|---|---|
| `APPRECIATION` | INFO | "Outstanding work on Q2 deliverables" |
| `WARNING` | MEDIUM | "Late attendance 5 days this month" |
| `DISCIPLINARY` | HIGH | "Insubordination on shop floor" |
| `INFORMATION` | INFO | "Policy update — please read" |
| `TRAINING` | LOW | "Mandatory safety refresher" |

### 10.2 Issuing a Memo (HR)

```
HR opens   EmployeeMemos page
HR clicks  "+ New Memo"
Fills      Employee, Type, Severity, Subject, Description,
           Issued By, Date, Attachment (optional)
Submits    POST /memos (multipart if attachment)
Backend    - Generates MEMO_NUMBER (MEMO-YYYY-nnnn)
           - Saves attachment to /static/memo-attachments/
           - Creates EmployeeMemo row
           - Sends in-app notification to employee
```

### 10.3 Employee Acknowledgement

Employee sees memos on dashboard under "My Memos". Each unacknowledged memo shows:

```
⚠️ WARNING #MEMO-2026-0042              [Acknowledge]
Subject:     Late attendance — 5 occurrences
Severity:    MEDIUM
Issued by:   Hari Krishnan (HR Manager)
Date:        2026-06-04
```

Click **Acknowledge**:
- Modal asks for optional remark
- `POST /memos/{id}/acknowledge` flips `ACKNOWLEDGED_BY_EMPLOYEE=1`, stamps `ACKNOWLEDGED_DATE`
- HR sees the ack timestamp + remark in their view

### 10.4 Other Operations (HR only)

| Action | Endpoint | Effect |
|---|---|---|
| Edit | `PATCH /memos/{id}` | Update subject/description/severity |
| Close | `POST /memos/{id}/close` | STATUS → CLOSED |
| Cancel | `POST /memos/{id}/cancel` | STATUS → CANCELLED |
| Delete | `DELETE /memos/{id}` | Soft-delete (`DELETED_AT` timestamp) |
| Export | `GET /memos/export/csv?filters` | CSV download for filtered set |

### 10.5 Stats

`GET /memos/stats?employee_id=<id>` returns counts: total, active, closed, warnings, appreciations, disciplinary_open, pending_acknowledgement, last_memo_date, active_warnings.

---

## 11. Employee Documents

### 11.1 Document Types

```
AADHAAR     PAN         RESUME       OFFER_LETTER
CERTIFICATE EDUCATION   EXPERIENCE   BANK_PROOF
ID_PROOF    OTHER
```

### 11.2 Upload (HR only)

```
POST /employees/{employee_id}/documents
multipart:
  file:          <binary>
  doc_type:      "AADHAAR"
  title:         "Aadhaar Card Front"
  notes:         "Issued 2018"
  uploaded_by_id: <admin uuid>
```

Backend saves to `/static/employee-docs/{employee_id}/{filename}` and creates an `EmployeeDocument` row referencing the URL.

### 11.3 View (Employee can see own)

```
GET /employees/{employee_id}/documents
GET /employees/{employee_id}/documents?doc_type=AADHAAR
```

Returns metadata + signed file URLs. Frontend shows them as a download list on the profile section.

### 11.4 Delete (HR only)

```
DELETE /employees/{employee_id}/documents/{doc_id}
```

Removes file from disk (best-effort) and deletes the row.

---

## 12. Performance, Productivity & Rewards

### 12.1 Scoring Inputs

`backend/app/services/performance_service.py` aggregates over a rolling window (default 30 days):

| Input | Weight | Source |
|---|---|---|
| On-time completion rate | 30% | `task_assignment.END_TIME` vs `DUE_DATE` |
| Attendance % | 20% | `attendance.STATUS` count |
| Stage-flow contribution | 15% | `work_order_stage_progress` |
| Quality (no NCRs) | 15% | `ncr` rows where assignee = employee |
| Memo impact | 10% | -ve for active WARNING / DISCIPLINARY |
| Workload throughput | 10% | Tasks completed / period |

Output: `performance_score` (0–100), `band` (★1–★5), `suggested_increment_pct`.

### 12.2 Where the Score Surfaces

- Employee Dashboard top card (★ rating)
- HR Dashboard performance row
- Chatbot: "performance summary" → top + bottom + averages
- Payroll suggestions for annual increment

### 12.3 Refresh Cadence

The portal-dashboard endpoint returns a cached score (updated on task completion). For a lighter refresh:

```
GET /employee/{employee_id}/performance-only
```

Hit every 60 seconds from the dashboard.

---

## 13. The Floating ERP Assistant (Chatbot)

The chatbot is the **only feature that bridges every module** — employees can do nearly everything through conversation.

### 13.1 Architecture

```
Frontend  ChatBot.jsx
          - employeeId read from localStorage
          - leave_state persisted per-employee in localStorage
          - POST /chat/stream (Server-Sent Events)

Backend   chatbot.py
          chat_stream() generator yields SSE events:
            { type: "source", source: "leave" | "rules" }
            { type: "text", text: "..." }
            { type: "items", items: [...] }
            { type: "suggestions", suggestions: ["chip1", ...] }
            { type: "leave_state", state: {...}, ready_to_submit: bool }
            { type: "done" }

          Routing priority:
          1. Leave Bridge       (if employee_id set AND leave intent)
          2. Entity Lookup      (type any name → profile)
          3. Rule-based Intent  (~50 intents, synonym-aware)
          4. Topic Fallback     (friendly hint with chips)
```

### 13.2 Leave Multi-Turn Workflow

**One-shot (everything in one message):**
```
You:  i need casual leave tomorrow for family function
Bot:  Ready to submit:
      • Type:   CASUAL LEAVE
      • Date:   2026-06-07 (1 day)
      • Reason: family function
      Your CASUAL balance: 12d → 11d after this leave.
      [Confirm & Submit] [Change date] [Change reason] [Cancel]

You:  Confirm & Submit
Bot:  ✅ Submitted! Your leave request #24 is now with HR for approval.
      📧 An email has been sent to the approver.
      📋 You can ask me 'leave status' anytime to check approval.
```

**Multi-turn (bot fills missing slots):**
```
You:  i need leave next monday
Bot:  Got: date 2026-06-08 · reason "i need leave next monday".
      What type of leave do you need?
      [Casual] [Sick] [Earned] [Unpaid]

You:  sick leave, viral fever
Bot:  Ready to submit: ...
      [Confirm & Submit] ...
```

### 13.3 Status Check
```
You:  what is my leave status   (or 'leave history', 'is my leave approved')
Bot:  Here are your recent leave requests:
      ⏳ #18 SICK    · 2026-06-15 · Pending Approval
      ✅ #16 CASUAL  · 2026-05-22 · Approved
      ❌ #14 EARNED  · 2026-04-10 · Rejected
         Rejection: Project deadline this week
```

### 13.4 Other Things Both Employees & HR Can Ask

See the dedicated chatbot capability sheet for the full ~50-intent catalogue. Quick examples:

| Category | Example questions |
|---|---|
| Greeting / help | `hi`, `help`, `what can you do` |
| Self leave | `apply casual leave tomorrow`, `half day on 10th`, `cancel my leave` |
| Leave status | `leave status`, `my leave balance`, `leave history` |
| HR overview | `pending leave requests`, `who is on leave today`, `leave summary` |
| Attendance | `who is in office`, `late today`, `absent today`, `attendance today` |
| Production | `production status`, `work orders`, `machine models`, `show BOM` |
| Quality | `open NCRs`, `quality status` |
| Suppliers | `list suppliers`, `suppliers in Electronics` |
| Performance | `performance summary`, `top employees` |
| Inventory | `low stock`, `out of stock`, `inventory value` |
| Tasks | `pending tasks`, `overdue`, `workload summary` |
| Entity lookup | Type any name: `Hemnath`, `Snack Combo`, `ABC Foods` |

---

## 14. Employee API Reference

> Endpoint base: `http://<backend-host>:8001`
> All listed endpoints are employee-relevant. Admin-only endpoints are in [docs/api/03-hr.md](./api/03-hr.md).

### 14.1 Authentication
| Method | Path | Purpose |
|---|---|---|
| POST | `/employee-login` | Login + auto check-in |
| POST | `/employee-logout` | Logout + check-out |
| POST | `/employee-onboarding/{token}/login` | Token-gated public flow |

### 14.2 Profile & Documents
| Method | Path | Purpose |
|---|---|---|
| GET | `/employees/by-code/{code}` | Self-lookup |
| POST | `/employees/by-code/{code}/submit-profile` | One-shot self-reg |
| POST | `/employees/{id}/upload-photo` | Profile picture (multipart) |
| GET | `/employees/{id}/documents` | List own documents |
| GET | `/employees/{id}/documents/{doc_id}` | One document |

### 14.3 Dashboard
| Method | Path | Purpose |
|---|---|---|
| GET | `/employee/{id}/portal-dashboard` | One-shot dashboard load |
| GET | `/employee/{id}/performance-only` | Cheap performance refresh |
| GET | `/connect/employee/{id}/360` | Full 360° snapshot |

### 14.4 Tasks
| Method | Path | Purpose |
|---|---|---|
| GET | `/employee/{ref}/today-task` | Today's active task |
| GET | `/employee/{ref}/tasks` | All tasks grouped |
| GET | `/employee/{ref}/pending-from-yesterday` | Carryover |
| GET | `/employee/{ref}/pending-acceptance` | Awaiting accept/reject |
| PATCH | `/task-assignment/{id}/accept` | Accept task |
| PATCH | `/task-assignment/{id}/reject` | Reject task |
| PATCH | `/employee/{id}/tasks/{aid}/status` | Update status |

### 14.5 Attendance
| Method | Path | Purpose |
|---|---|---|
| POST | `/check-in` | Manual check-in (with GPS) |
| POST | `/check-out` | Manual check-out |
| GET | `/attendance/today` | Today's board |
| GET | `/attendance/live-board` | Live floor display (10s poll) |

### 14.6 Leave
| Method | Path | Purpose |
|---|---|---|
| POST | `/leave/apply` | Day-leave application |
| POST | `/leave/apply-permission` | Hourly permission |
| GET | `/leave/balance/{id}` | Quota check |
| GET | `/leave/my-requests` | Leave history |
| GET | `/leave/my-permissions` | Permission history |
| GET | `/leave/dashboard-summary/{id}` | KPI counts |
| PATCH | `/leave/{id}/cancel` | Cancel pending/approved |
| GET | `/leave/decide/{token}` | Approver action (HTML page) |

### 14.7 Memos
| Method | Path | Purpose |
|---|---|---|
| GET | `/memos/employee/{id}` | Own memos |
| POST | `/memos/{id}/acknowledge` | Acknowledge receipt |

### 14.8 Geofence
| Method | Path | Purpose |
|---|---|---|
| GET | `/geofence/settings` | Office centre + radius |
| POST | `/geofence/validate` | lat/lng → allowed bool |
| POST | `/geofence/log-failure` | Audit failed attempt |

### 14.9 Chatbot
| Method | Path | Purpose |
|---|---|---|
| POST | `/chat/stream` | SSE multi-turn chat |
| GET | `/chat/suggestions` | Quick-reply chips |
| GET | `/chat/health` | Component status |

### 14.10 Notifications
| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications?employee_id=<id>` | Inbox |
| GET | `/notifications/unread-count?employee_id=<id>` | Badge counter |
| PATCH | `/notifications/{id}/read` | Mark read |

---

## 15. Notifications & Email

### 15.1 In-App Notifications

The `notification` table holds per-employee messages. Triggered by:
- Task assignment
- Leave approved / rejected
- Memo issued
- Production stage unlock
- System alerts

The dashboard polls `GET /notifications/unread-count` every 30s and the bell icon shows the badge. Voice alerts fire if the employee has `localStorage.voice_enabled === 'true'`.

### 15.2 Email — SMTP Setup

Outbound mail is required for:
- Leave approval links to managers
- Decision emails back to employees
- Task assignment notifications
- Memo notifications (optional)

Configure in `backend/.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-sender@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="BVC24 ERP <noreply@bvc24.com>"

# OR use Resend
RESEND_API_KEY=re_xxxxxxxxxxxxxx
RESEND_FROM=onboarding@resend.dev

# Useful in dev — re-routes all outbound to one address
EMAIL_TESTING_OVERRIDE_TO=qa-inbox@yourdomain.com
```

### 15.3 Approver Address Resolution

`leave.py` picks the approver for a request in this order:
1. `Employee.MANAGER_ID` → that employee's email
2. Department head (`Department.HEAD_EMPLOYEE_ID`)
3. Vendor's default approver
4. Hard-coded admin (fallback, sends a warning)

If step 4 is hit and no fallback is set, the request is still created with `STATUS=PENDING_APPROVAL` but no email is sent. HR can approve manually from the Leave Management page.

---

## 16. Production Deployment Checklist

Before letting real employees use the system, work through every box.

### 16.1 Environment Variables

`backend/.env`:
```env
# Database
DATABASE_URL=mysql+pymysql://user:pass@localhost:3306/bvc24_prod

# JWT
JWT_SECRET=<random-64-char-string>
JWT_ALGORITHM=HS256
JWT_EXP_MINUTES=720

# SMTP / Email
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="BVC24 <noreply@yourco.com>"

# Public URL (used in emailed approval links)
PUBLIC_FRONTEND_URL=https://erp.yourco.com
PUBLIC_BACKEND_URL=https://api.yourco.com

# Vendor scope
DEFAULT_VENDOR_ID=1

# Optional
EMAIL_TESTING_OVERRIDE_TO=
GEMINI_API_KEY=          # leave empty for rule-based-only chatbot
```

`frontend/.env`:
```env
VITE_API_URL=https://api.yourco.com
```

### 16.2 Database Setup

```bash
# 1. Create database
mysql -u root -p -e "CREATE DATABASE bvc24_prod CHARACTER SET utf8mb4;"

# 2. Run migrations (tables auto-create on first uvicorn start via Base.metadata.create_all)
cd backend && ./venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001

# 3. Seed reference data (departments, designations, roles)
./venv/Scripts/python.exe scripts/seed_reference_data.py

# 4. Configure geofence
mysql -u root -p bvc24_prod -e "
  INSERT INTO geofence_settings
    (VENDOR_ID, OFFICE_NAME, LATITUDE, LONGITUDE, RADIUS_METERS, IS_ACTIVE)
  VALUES
    (1, 'Bharath Vending HQ', 11.0168, 76.9558, 100, 1);
"

# 5. Configure leave quotas (or use the LeavePolicy admin UI)
./venv/Scripts/python.exe scripts/seed_default_leave_policy.py
```

### 16.3 First Admin Account

```bash
./venv/Scripts/python.exe scripts/create_admin.py \
  --email admin@yourco.com \
  --password <strong-password> \
  --name "System Administrator"
```

### 16.4 Backend Process

Use a process supervisor (NSSM on Windows, systemd on Linux, Docker, or PM2). Example NSSM (Windows):

```powershell
nssm install BVC24-Backend "d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend\venv\Scripts\python.exe"
nssm set BVC24-Backend AppParameters "-m uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 2"
nssm set BVC24-Backend AppDirectory "d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend"
nssm set BVC24-Backend AppStdout "d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend\uvicorn.log"
nssm set BVC24-Backend AppStderr "d:\PUVI-DOC\Vendor-based Manufacturing ERP\backend\uvicorn.err"
nssm start BVC24-Backend
```

### 16.5 Frontend Build & Serve

```bash
cd frontend
npm install
npm run build              # generates dist/
# Serve with nginx, Caddy, or `serve -s dist -l 5173`
```

### 16.6 HTTPS Reverse Proxy

Required for mobile GPS. Minimal Caddy config (`Caddyfile`):

```
erp.yourco.com {
    root * /var/www/bvc24/frontend/dist
    try_files {path} /index.html
    file_server
}

api.yourco.com {
    reverse_proxy localhost:8001
}
```

Caddy auto-provisions Let's Encrypt certs. With this in place, mobile GPS works without flag overrides.

### 16.7 Cron / Scheduled Jobs

Required for daily housekeeping:

| Job | Schedule | Action |
|---|---|---|
| Mark Absent | 23:55 daily | Insert ABSENT rows for missing employees |
| Daily Backup | 02:00 daily | mysqldump → S3 or local backup folder |
| Performance Refresh | Hourly | Re-compute scoring (`scripts/refresh_performance.py`) |
| Leave Balance Accrual | Monthly (1st 00:05) | Top up CASUAL / SICK per policy |
| Stale Token Cleanup | Weekly | Invalidate unused leave-approval tokens older than 30 days |

Sample Windows Task Scheduler entry for "Mark Absent":
```powershell
schtasks /Create /TN "BVC24-MarkAbsent" /TR "d:\...\backend\venv\Scripts\python.exe d:\...\backend\scripts\mark_absent.py" /SC DAILY /ST 23:55
```

### 16.8 Firewall & Network

| Port | Purpose | Exposure |
|---|---|---|
| 443 | HTTPS (frontend + reverse-proxied API) | Public |
| 80 | HTTP → HTTPS redirect | Public |
| 8001 | Backend uvicorn | LAN only (firewall block external) |
| 3306 | MySQL | Localhost only |

### 16.9 Smoke Test Before Launch

Run these to validate end-to-end:

1. ☐ Create a test employee
2. ☐ Log in as that employee at the public URL
3. ☐ Complete self-registration form
4. ☐ Verify dashboard renders with no console errors
5. ☐ Check in from inside the office (geofence valid)
6. ☐ Apply for leave via chatbot → confirm submit
7. ☐ Verify approval email arrived
8. ☐ Click approve link → verify HTML page renders
9. ☐ Verify in-app notification arrived for employee
10. ☐ Ask chatbot: "what is my leave status" → confirm shows approved
11. ☐ Check out → verify worked hours computed
12. ☐ Try check-in from outside geofence → confirm blocked
13. ☐ Open from phone on LAN → confirm everything still works
14. ☐ Issue a memo → employee acknowledges → HR sees timestamp

### 16.10 Rollback Plan

If a release breaks:
```powershell
# Stop service
nssm stop BVC24-Backend

# Revert code
cd backend
git checkout <last-known-good-commit>

# Restart
nssm start BVC24-Backend
```

Database migrations should always be additive (add columns, don't drop) so the previous version's code keeps working.

---

## 17. Security Considerations

### 17.1 Current State (Honest Assessment)

| Concern | Status | Notes |
|---|:---:|---|
| Passwords bcrypt-hashed | ✅ | `connect.py` uses `passlib` |
| JWT issued on login | ✅ | 12h expiry by default |
| JWT verified on endpoints | ⚠️ Partial | Many endpoints are `Auth: None` — relying on frontend gating |
| HTTPS in production | ⚠️ Required | Not enforced in code; deploy behind reverse proxy |
| GPS spoofing detection | ❌ | Trusts browser-reported lat/lng |
| Approval-link tokens | ✅ | Single-use, signed |
| SQL injection | ✅ | SQLAlchemy parameterised queries |
| XSS in chatbot output | ⚠️ Partial | React's default escaping protects; `dangerouslySetInnerHTML` not used |
| CSRF | ❌ | No CSRF tokens; rely on SameSite cookies (set by reverse proxy) |
| File upload validation | ⚠️ Partial | Extension checked; magic-byte check would harden |

### 17.2 Hardening Before Public Internet Exposure

1. **Add JWT verification to every employee-only endpoint** — wrap with a `Depends(get_current_employee)` that decodes and validates.
2. **Rate-limit `/employee-login`** — 5 attempts per IP per 15 min.
3. **Force HTTPS** — backend sets `Strict-Transport-Security` header; frontend rejects `http://` API base.
4. **Rotate JWT secret** — generate fresh on first deploy; never commit `.env`.
5. **Audit file uploads** — Set max size (10MB photo, 25MB doc); verify magic bytes; quarantine to a non-served folder during scan.
6. **GPS sanity checks** — Reject lat/lng outside India bounding box; flag impossible velocity (>200 km/h between scans).
7. **Failed-login monitoring** — Email security@ on N+ failures from one IP.
8. **DB user least privilege** — App DB user has DML on bvc24_prod only; no DROP / CREATE / GRANT.

### 17.3 Data Retention

| Data | Retention |
|---|---|
| Biometric scans | 1 year |
| Attendance | Permanent (audit) |
| Leave requests | Permanent |
| Memos (active + closed) | 7 years |
| Memos (deleted) | 1 year (soft-deleted) |
| Security log | 90 days |
| Notifications | 90 days |

Schedule a quarterly job to apply these retention windows.

---

## 18. Troubleshooting Runbook

### 18.1 Employee can't log in

```
1. Verify EMPLOYEE_CODE exists in the employee table:
   SELECT ID, EMPLOYEE_CODE, STATUS FROM employee WHERE EMPLOYEE_CODE='EMP101';

2. Check STATUS:
     ACTIVE     → fine
     SUSPENDED  → "Account suspended" error
     RESIGNED   → "Account inactive" error
     TERMINATED → same

3. Reset password if forgotten:
   PUT /employees/{employee_id}/reset-password { NEW_PASSWORD: "..." }

4. Check uvicorn logs for the actual error:
   tail -f backend/uvicorn.err
```

### 18.2 GPS shows "Permission Denied" on phone

```
1. Browser settings → Site settings → Location → Allow
2. iOS: Settings → Safari → Location → Allow (also enable for Chrome)
3. If on http://<LAN-IP>:5174:
     Chrome flags → "Insecure origins treated as secure" → add URL
     OR deploy behind HTTPS (Caddy, see §16.6)
4. Verify with: navigator.geolocation in browser console
   - undefined  → not exposed (probably http issue)
   - object     → API present, check permission
```

### 18.3 Check-in says "Outside Office Geofence" but employee is inside

```
1. Verify geofence settings:
   GET /geofence/settings
   → check LATITUDE, LONGITUDE, RADIUS_METERS

2. Get device's reported coords:
   In browser console: navigator.geolocation.getCurrentPosition(p => console.log(p.coords));

3. Compute haversine distance manually.
   If > RADIUS_METERS:
     - Increase RADIUS_METERS (try 150-200m for noisy GPS)
     - Or update OFFICE_LATITUDE/LONGITUDE to match actual centre

4. Indoor GPS is unreliable. Recommend kiosk-based biometric check-in for
   employees whose desks are deep inside a building.
```

### 18.4 Leave approval email not arriving

```
1. Check SMTP config in backend/.env
2. Check uvicorn.log for "Email sent" or error trace
3. Verify EMAIL_TESTING_OVERRIDE_TO isn't set (would re-route to QA)
4. Check approver resolution:
     SELECT MANAGER_ID FROM employee WHERE ID=<applicant>;
     SELECT EMAIL FROM employee WHERE ID=<manager>;
5. Gmail: enable App Password; SMTP_PASS isn't your account password
6. Resend: check API key + verified domain
```

### 18.5 Chatbot returns "source: rules" for leave request

This used to happen when the backend hadn't reloaded after a code change.

```
1. Verify only one uvicorn listens on 8001:
   netstat -ano | findstr :8001 | findstr LISTENING
2. If multiple, stop all python processes and restart cleanly
3. Verify the chat health endpoint:
   GET /chat/health
4. Check Logs for "Leave bridge" being hit
```

### 18.6 Dashboard shows stale data

```
1. portal-dashboard caches for 60s. Hard refresh: Ctrl+Shift+R
2. Check API call in browser DevTools → Network — verify 200
3. Verify token isn't expired (would 401 and bounce to /login)
4. Backend log shows any SQLAlchemy errors
```

### 18.7 Task status update fails

```
1. Endpoint requires JWT in production (Authorization: Bearer <token>)
2. Check task ownership: employee can only update own tasks
3. Verify APPROVAL_STATUS=APPROVED (rejected tasks can't be progressed)
4. Status must be one of: PENDING, IN_PROGRESS, COMPLETED, ON_HOLD
```

### 18.8 Memo acknowledgement doesn't update HR view

```
1. Verify the POST succeeded (200 response with acknowledged_date)
2. HR view caches employee filter — change filter and back
3. SQL check:
   SELECT ID, ACKNOWLEDGED_BY_EMPLOYEE, ACKNOWLEDGED_DATE
   FROM employee_memo WHERE ID=<memo_id>;
```

---

## 19. HR / Admin Operational Tasks

### 19.1 Onboard a New Employee

```
1. Dashboard → Employees → "+ Add Employee"
2. Fill required fields. Set initial password.
3. Share EMPLOYEE_CODE + password with employee (secure channel)
4. Optionally upload photo + documents now
5. Employee will self-complete profile on first login
```

### 19.2 Reset Forgotten Password

```
1. Dashboard → Employees → click employee row
2. "Reset Password" → enter new value
3. Share with employee
```

### 19.3 Approve a Leave Request

```
Email channel: click [Approve ✓] in inbox → done
In-app channel: Dashboard → Leave Management → row → Approve/Reject
```

### 19.4 Issue a Memo

```
Dashboard → Memos → "+ New Memo"
Select employee, type, severity, fill subject + description,
attach file if needed, submit. Employee gets notification.
```

### 19.5 Update Geofence

```
Dashboard → Settings → Geofence
Update OFFICE_NAME, LATITUDE, LONGITUDE, RADIUS_METERS
Toggle IS_ACTIVE to enable/disable enforcement
```

### 19.6 Export Memos to CSV

```
Memos page → set filters → "Export CSV"
Or: GET /memos/export/csv?employee_id=...&memo_type=WARNING
```

### 19.7 Adjust Leave Policy

```
Dashboard → Leave → Policies
Edit CASUAL_DAYS, SICK_DAYS, EARNED_DAYS, MATERNITY_DAYS
Scope can be: GLOBAL, DEPARTMENT, DESIGNATION, INDIVIDUAL
More specific scope wins. See backend/app/routes/leave.py for resolution rules.
```

### 19.8 Mark Employee Resigned / Terminated

```
Dashboard → Employees → row → Edit
Change STATUS to RESIGNED or TERMINATED
Record DATE_OF_LEAVING
Employee can no longer log in; data preserved for audit.
```

### 19.9 Bulk Mark Absent (if cron didn't run)

```
POST /attendance/mark-absent
{ "EMPLOYEE_ID": "<uuid>", "VENDOR_ID": 1, "NOTE": "No-show" }
```

Or run the script manually:
```powershell
./venv/Scripts/python.exe scripts/mark_absent.py --date 2026-06-05
```

---

## 20. Extending the Module

### 20.1 Add a New Leave Type

1. `backend/app/routes/leave.py` → add to `VALID_LEAVE_TYPES`
2. If quota-backed, add to `QUOTA_BACKED_TYPES` + `LeaveBalance` table column
3. `backend/app/services/leave_chatbot_service.py` → add to `VALID_LEAVE_TYPES` for NLU
4. Frontend `ApplyLeave.jsx` → add to the dropdown options
5. Update this doc's §8.1 table

### 20.2 Add a New Dashboard Section

1. Backend: add a new field to `portal-dashboard` response (don't break existing keys)
2. Frontend: read `dashboardData.<new_field>` in `EmployeeDashboard.jsx`
3. Render a new section component

### 20.3 Add a New Chatbot Intent

`backend/app/routes/chatbot.py`:
```python
def handle_my_new_intent(tok_set, raw, db):
    # ... query DB ...
    return reply("My new answer", suggestions=["...", "..."])

# In build_rules(), add:
add(lambda t: has(t, "my_concept"), handle_my_new_intent, "my_intent")
```

That's it — the SSE streaming pipeline handles it.

### 20.4 Wire a New Notification Trigger

```python
from app.models.models import Notification

db.add(Notification(
    EMPLOYEE_ID = emp.ID,
    TITLE       = "Something happened",
    BODY        = "Details here",
    TYPE        = "INFO",      # or WARNING, SUCCESS
    LINK        = "/some-path" # optional deep link
))
db.commit()
```

The dashboard's poll picks it up within 30s.

---

## Appendix A — localStorage Keys

| Key | Set by | Cleared by | Purpose |
|---|---|---|---|
| `auth` | Login | Logout, 401 | Gate for `ProtectedRoute` |
| `role` | Login | Logout | `"admin"` or `"employee"` |
| `token` | Login | Logout, 401 | JWT bearer |
| `employee_id` | Employee login | Logout | UUID of current employee |
| `employee_name` | Employee login | Logout | Display name |
| `department` | Employee login | Logout | For profile card |
| `employee_role` | Employee login | Logout | Designation / role label |
| `loginTime` | Employee login | Logout | Session age |
| `attendance_status` | Employee login | Logout | PRESENT / LATE flag |
| `pending_yesterday` | Employee login | Acknowledge | Carry-over banner trigger |
| `pending_onboarding_token` | sessionStorage; OnboardingChat | onboarding done | Locks login to Employee tab |
| `chatbot_leave_state_{employee_id}` | ChatBot leave flow | Cancel / submit | Multi-turn state per employee |
| `voice_enabled` | Settings toggle | User | Voice alert preference |

---

## Appendix B — State Transitions

### Attendance.STATUS
```
(none)
  │
  ├── on time check-in   → PRESENT
  ├── late check-in      → LATE  (+ auto LATE_COMING Permission)
  └── no scan + cron     → ABSENT
```

### LeaveRequest.STATUS
```
(create) ──▶ PENDING_APPROVAL
                  │
                  ├──(approve link)──▶ APPROVED ──▶ (employee cancels)──▶ CANCELLED + refund
                  ├──(reject link) ──▶ REJECTED
                  └──(employee cancels)──▶ CANCELLED
```

### TaskAssignment.APPROVAL_STATUS
```
PENDING ──▶ APPROVED (employee accepts) ──▶ usable
        └─▶ REJECTED (employee rejects) ──▶ system tries auto-reassign
```

### TaskAssignment.TASK_STATUS
```
PENDING ──▶ IN_PROGRESS ──▶ COMPLETED
                  ↑    ↓
                  └ ON_HOLD
```

### EmployeeMemo.STATUS
```
ACTIVE ──▶ CLOSED   (manual close after acknowledgement)
       ├─▶ CANCELLED (issued by mistake)
       └─▶ (soft-deleted: DELETED_AT set, hidden from default queries)
```

---

## Appendix C — Quick Reference for Employees

> Print this page and pin it near workstations.

### Logging In
1. Open the ERP URL in any browser (Chrome, Firefox, Safari).
2. Click the **Employee** tab.
3. Enter your **Employee Code** (e.g. `EMP101`) and password.
4. First time? You'll see a profile form — fill it once and submit.

### Daily Workflow
- **Morning:** Logging in auto-marks your attendance. If you're outside the office, GPS will block check-in.
- **Find your task:** "Today's Tasks" section at the top of your dashboard.
- **Start work:** Click **Start Task** → status flips to *In Progress*.
- **Done:** Click **Complete** → you earn points + the next task unlocks.
- **Need to step out briefly:** Click **Hold**.
- **End of day:** Click **Logout** (top-right) to check out and record your worked hours.

### Applying for Leave (three ways)
1. **Inline form** — bottom of your dashboard
2. **Standalone page** — `/apply-leave`
3. **Chatbot (easiest)** — click the red bubble bottom-right, type:
   > "I need casual leave tomorrow for family function"
   The bot will confirm, then click **Confirm & Submit**.

### Checking Leave Status
Type in the chatbot: **"what is my leave status"** — you'll see the status of every recent request.

### Permission (Hourly)
Use the **Apply for Permission** form for short absences (doctor visit, errand). Different from day-leave; doesn't deduct quota.

### Acknowledging a Memo
Whenever HR issues you a memo, it appears under **My Memos**. Click **Acknowledge** and optionally add a remark.

### If Something Doesn't Work
| Symptom | Try |
|---|---|
| Can't log in | Check caps lock; ask HR to reset password |
| "Outside Office Geofence" | Make sure you're inside the office; check phone has GPS on |
| GPS denied on phone | Browser settings → Site permissions → Location → Allow |
| Chatbot doesn't respond | Refresh page; check internet |
| Forgot password | Ask HR to reset (Dashboard → Employees → your row → Reset Password) |

### Who to Contact
| Issue | Contact |
|---|---|
| Login / password | HR |
| Wrong attendance | HR (with proof of presence) |
| Leave rejected unfairly | Your manager (then HR) |
| Memo dispute | HR (use the "Remark" field when acknowledging) |
| System bug | IT / your team's tech lead |

---

*Document version: 1.0 · Last updated: 2026-06-06 · Maintained by: BVC24 Platform Team*
