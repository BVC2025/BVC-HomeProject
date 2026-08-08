# BVC24 HRMS Knowledge Base

> This document is the **only** knowledge source used by the BVC24 HRMS AI
> Assistant. Every fact the assistant states about attendance, leave,
> payroll, memos, announcements, notifications and related HR modules is
> retrieved from the sections below.
>
> **Editing rule:** every subsection is introduced by a level-3 heading
> (`###`). The AI's chunker splits on those H3s, so keep them stable.
> After any edit, run:
>
> ```
> cd backend
> python -m app.hrms_ai.knowledge_builder
> ```
>
> or hit `POST /hrms-ai/rebuild` (admin only) to refresh the embedding
> index — the running server picks it up automatically.

---

## Table of contents

- Attendance
- Leave
- Permission
- Payroll
- Allowance (expense claims)
- Memos
- Announcements
- Notifications
- Star Performance
- Onboarding
- Organization Chart
- Roles & Permissions

---

## Module: Attendance

### What it does
Attendance records when each employee starts and ends their working day and how many hours they put in. You can mark yourself in and out from the web portal, from a fingerprint reader on the wall, or from an admin-uploaded USB export of the device log. The system keeps one row per person per day and separately tracks overtime that runs past the end of the regular shift.

### Who can use it
- Any employee, signed in with their own account, can check in, check out, start and end an overtime session, and view their own daily and monthly attendance.
- HR and admin users (permission codes `attendance.view.all`, `attendance.mark.others`, `attendance.delete`) can view the whole company, mark someone else absent, delete a row, export the monthly Excel, and see the live floor board and monthly summary.
- The biometric device itself pushes punches into `/iclock/*` endpoints without a login, identified only by its serial number.

### How it works
1. The employee opens the ESS attendance widget or places their finger on the ZKTeco/ESSL reader.
2. On a web check-in, the browser sends latitude/longitude; the server re-validates the point against the office geofence and rejects the call if it is outside the radius unless `BYPASS_GEOFENCE` is set.
3. The server looks up (or creates) the day's Attendance row for that employee, writes `CHECK_IN`, and stamps `STATUS` as PRESENT or LATE.
4. On check-out the server fills `CHECK_OUT` and `WORKED_HOURS`. Overtime is a second, separate session that the employee starts explicitly through `ot-check-in`.
5. For biometric punches, the ADMS handler decides whether each scan is an arrival or a departure by time-of-day (see rules), writes a `BiometricEvent` audit row, then updates the same Attendance row. Punches past 18:00 automatically split into regular hours plus overtime hours.
6. At 23:55 a scheduled task marks every active employee with no row for that day as ABSENT.
7. A monthly summary service rolls each employee's rows into counts (present, late, absent, half-day, missed check-outs), total minutes late, total OT hours, and a star-score contribution.

### Business rules
- Working hours start at 09:15. A check-in with a wall-clock time later than 09:15 is stored as `LATE`; on or before is `PRESENT`.
- Regular shift ends at 18:00. On biometric punches, any time worked past 18:00 is moved into `OVERTIME_HOURS` and mirrored on `OT_CHECK_IN` / `OT_CHECK_OUT`; time up to 18:00 stays in `WORKED_HOURS`.
- Overtime from the web portal is not auto-derived. The employee must call `ot-check-in` after completing the regular check-out; OT hours are then `OT_CHECK_OUT - OT_CHECK_IN`.
- Morning cutoff for biometric punches is 13:00 (1:00 PM). A scan strictly before 13:00 counts as `CHECK_IN` when none is recorded; a second morning scan is treated as a duplicate and ignored (not as an early exit). A scan at or after 13:00 counts as `CHECK_OUT`; the latest evening scan wins over an earlier one.
- Biometric dedup window is 60 seconds. Two punches from the same employee within that window are collapsed into one.
- Sunday is the weekly off. Working days in a month are all days minus Sundays and minus any date in the holiday calendar.
- A day counts as an unpaid absence only if there is no attendance row AND no approved leave for that date AND that date is a working day.
- A "missed check-out" is a day where `CHECK_IN` is set but `CHECK_OUT` is empty.
- Monthly memo triggers (per employee, per calendar month): 5 or more late arrivals, 1 or more unpaid absences, or 5 or more missed check-outs makes the employee warning-memo eligible. Zero late arrivals AND zero unpaid absences AND at least one present day makes them appreciation-memo eligible.
- Attendance star-score component (out of 80): attendance = present ÷ working days × 40 (capped at 40), punctuality = 20 − (late arrivals × 5), overtime = OT hours × 2 (capped at 20).
- Attendance-AI scanner window is 30 days. Alert thresholds: 3 late (WARNING) / 6 late (CRITICAL), 2 absent (WARNING) / 4 absent (CRITICAL), 3 early exits (WARNING), 12 cumulative OT hours or 3 days with more than 3 OT hours (WARNING).
- Geofence enforcement is on by default with a 50-metre radius; it can be turned off per vendor.
- One attendance row per employee per day is enforced by the `uq_attendance_employee_date` uniqueness rule.

### Approval workflow
Attendance has no request/approval loop. Rows are written directly by the employee, the biometric device, or an admin. Warning and appreciation memos generated from the monthly summary are surfaced to HR for review, not routed through an approval chain.

### Automation
- Windows Task `BVC24-MarkAbsent` runs the script `mark_absent.py` daily at 23:55 and inserts an ABSENT row for every active employee who has no row for today.
- `/attendance-ai/scan` is idempotent and designed to be triggered daily (documented target: 07:00) to raise/refresh pattern alerts.
- The monthly memo evaluator consumes the same summary service to decide who receives a warning or appreciation memo at month roll-over.

### Notifications sent
When the AI scanner raises a new attendance alert (late pattern, absent pattern, early-exit pattern, or OT abuse), it inserts one row into the `Notification` table with type `ATTENDANCE_ALERT` so it appears in the HR bell icon. Duplicate alerts for the same employee/key on the same day are updated in place instead of re-notifying.

### Frontend surface
- Employee: ESS "My Attendance" widget on the Employee Portal, plus the "My Monthly Attendance" calendar picker.
- HR/admin: the Attendance page with Today, All Records, Live Floor Board, Monthly Summary, Tracking, Report, and Biometric Import tabs; plus the Geofence Settings page for office coordinates.

### Related endpoints
- POST `/check-in` — record today's arrival.
- POST `/check-out` — record today's departure and compute worked hours.
- POST `/ot-check-in` — start today's overtime session (regular check-out required first).
- POST `/ot-check-out` — close the OT session and compute overtime hours.
- POST `/mark-absent` — HR-only; force today's row to ABSENT.
- GET `/attendance` — filterable history for HR.
- GET `/attendance/today` — today's rows (admins see all, employees see their own).
- GET `/attendance/live-board` — one tile per active employee for the floor wall display.
- GET `/attendance/report` — per-employee aggregates across a date range.
- GET `/attendance/employee/{id}/tracking` — 90-day calendar heatmap data.
- GET `/attendance/download/xlsx` — monthly Excel export.
- GET `/attendance/summary/monthly` — HR monthly roll-up.
- GET `/attendance/summary/my` — employee's own monthly roll-up.
- DELETE `/attendance/{id}` — remove a row.
- GET/POST `/iclock/cdata`, `/iclock/getrequest`, `/iclock/devicecmd`, `/iclock/ping` — ADMS push protocol for ZKTeco/ESSL devices.
- POST `/iclock/import-attlog` — upload the USB-exported ATTLOG file.
- POST `/attendance-ai/scan` — run the 30-day pattern monitor.
- GET `/attendance-ai/alerts`, GET `/attendance-ai/at-risk`, POST `/attendance-ai/alerts/{id}/acknowledge`, POST `/attendance-ai/alerts/{id}/dismiss` — HR alert dashboard.

### Related database tables
- attendance
- biometric_event
- attendance_alert
- attendance_security_log
- geofence_settings
- holiday_calendar
- employee_memo
- notification

### Frequently-asked-question hints
- What time do I have to check in by to not be marked late?
- Why was I marked LATE today?
- How do I log overtime — is it counted automatically after 6 PM?
- I forgot to check out yesterday — what happens to my hours?
- The app says I'm outside the office geofence, how do I still check in?
- How does the fingerprint reader decide whether my punch is an arrival or a departure?
- How many late arrivals in a month get me a warning memo?
- Do Sundays and public holidays count against my attendance percentage?
- Where do I see my monthly attendance summary and star score?
- What happens if I'm absent without applying for leave?
- Why did an early-morning re-scan not check me out?
- How do I import attendance from the biometric device via USB?

---

## Module: Leave

### What it does
The Leave module lets you apply for days off, track your remaining balance, cancel requests you no longer need, and see the status of every leave you have ever submitted. Every leave request is routed to your manager, who approves or rejects it by clicking a button in an email or from the HR dashboard. Approved balance-backed leave (Casual, Sick, Earned, Maternity) is automatically deducted from your yearly quota; if you cancel an already-approved leave the days are refunded.

### Who can use it
- Every active employee (self-service) — apply, cancel, view own history, view own balance, apply hourly permission.
- HR / admin roles with permission code `leave.view.all` — see pending queue, full history, per-employee balance overview.
- Approvers with `leave.approve`, `leave.reject`, or `leave.decide` — approve/reject from the dashboard.
- Policy managers with `leave.policy.manage` — create/update/delete quota policies and manually adjust balances.

### How it works
1. Employee opens Apply Leave in ESS, picks a leave type, dates (or half-day), and types a reason.
2. The form checks the local balance strip; if the employee has already used one or more balance-consuming days this month and is now asking for two or more additional days of a balance-consuming type, a confirmation popup appears explaining that the days will be deducted from balance.
3. On submit the backend validates dates, half-day rules, quota availability, and overlap with existing requests, then stores a `LeaveRequest` row with status `PENDING_APPROVAL` and an approval token.
4. An email with green Approve and red Reject buttons is sent to the address in `APPROVER_EMAIL` (falls back to `ADMIN_EMAIL`).
5. When the manager clicks Approve, the token URL flips status to `APPROVED`, deducts the balance, invalidates the token, and sends the employee an approval email plus an in-app notification. Reject sets status to `REJECTED` with the reason and emails the employee.
6. Managers can achieve the same result from the Leave Management dashboard without opening the email.

### Business rules
- Valid leave types: CASUAL, SICK, EARNED, MATERNITY, UNPAID, LOP, OTHERS (day-based) and PERMISSION (hourly).
- Balance-backed (quota) types are CASUAL, SICK, EARNED, MATERNITY. UNPAID, LOP, OTHERS, and PERMISSION do NOT draw from balance.
- Default annual quotas: Casual 12 days, Sick 12 days, Earned 15 days, Maternity 180 days.
- Default carry-over to next year: Casual 0, Sick 0, Earned 15, Maternity 0. Carry-over is capped at the policy's limit and computed as `min(prior_year_remaining, limit)`.
- MATERNITY leave is available only to employees whose GENDER on file is FEMALE. For anyone else the quota is forced to 0.
- Every leave with `days > 0` requires manager approval — the auto-approve-without-reason threshold is 0 days.
- A non-empty reason is mandatory on every leave application; missing reasons are rejected with HTTP 400.
- START_DATE must be on or before END_DATE.
- Half-day (0.5 day) requests must have identical start and end date.
- A new request that overlaps any of the employee's existing PENDING_APPROVAL or APPROVED leaves is refused (HTTP 409).
- Quota check: for balance-backed types the request is refused if `days_requested > (TOTAL + CARRYOVER - USED)`.
- Balance-deduction confirmation popup fires in the ESS form when the employee has already used at least 1 balance-backed day in the current calendar month AND is now requesting 2 or more additional days of a balance-consuming type.
- Monthly Casual Leave rule (AI decision engine): the CL monthly quota is 1.0 day; exceeding it produces a warning that blocks auto-approval.
- AI auto-approve engine: only requests up to 1 day, with sufficient balance, no holiday clash, no team-coverage warning, and no pending-task warning are auto-approved. If more than 30% of an active department of 3+ people is already on approved leave on the same day, the request is flagged for human review. If the employee has 3 or more pending tasks, a warning is raised.
- Cancellation is allowed only while status is PENDING_APPROVAL or APPROVED; cancelling an APPROVED leave refunds the days to balance.
- Quota policies resolve in priority order: DESIGNATION → DEPARTMENT → COMPANY, first active match wins; falls back to the defaults if none exist.
- Hourly Permission: `DURATION_HOURS` must be greater than 0 and at most 8. Longer absences must be filed as a half-day or full-day leave. Permission subtypes are SHORT_PERMISSION, HALF_DAY, LATE_COMING, EARLY_EXIT. Only one pending/approved permission is allowed per employee per date.
- Permission requests always require manager approval and a reason; they do not touch leave balance.
- Manual balance adjustment by HR requires a reason of 3+ characters, a non-zero delta, and cannot push a leave-type total below zero; every adjustment is audit-logged.

### Approval workflow
- Every day-based leave with duration greater than 0 days is sent to the approver whose email is in the `APPROVER_EMAIL` environment variable (falls back to `ADMIN_EMAIL`).
- The email contains signed one-shot approve/reject links (`/leave/decide/{token}`) that stop working the moment the request is decided.
- Alternative path: the approver opens the Leave Management dashboard and clicks Approve or Reject, which enforces the RBAC permissions `leave.approve`, `leave.reject`, or `leave.decide`.
- Rejection captures a rejection reason (defaults to "Rejected by approver" from email, "Rejected from dashboard" from the dashboard).
- There is no escalation ladder — the same approver email receives every request. No auto-approve by time-out; requests stay `PENDING_APPROVAL` until acted on or cancelled by the employee.
- The AI decision service can auto-approve short single-day requests via `POST /leave-ai/bulk-auto-approve`, stamping `APPROVED_BY_EMAIL = "AI Auto-Approval"`.

### Automation
- No cron job runs the leave module on a schedule.
- `POST /leave-ai/bulk-auto-approve` is an on-demand sweep that HR (or a scheduled agent) can trigger to auto-approve every pending request whose AI verdict is AUTO_APPROVE.
- Attendance signals can auto-create PENDING_APPROVAL Permission rows for LATE_COMING or EARLY_EXIT via `auto_create_permission`, with an idempotency guard so the same day/subtype is not created twice.
- New-year balance rows are created lazily on first access (first balance query or first leave application of the year) and are seeded from the resolved quota policy plus capped carry-over from the prior year.

### Notifications sent
- Email to manager (`send_approval_email`) on every new day-based or hourly Permission submission that needs approval — subject "[BVC24] Leave request — {name} ({type}, {days})".
- Email to employee (`send_decision_email`) on APPROVED or REJECTED — subject "[BVC24] Leave Approved/Rejected — {date}".
- In-app Notification "Leave auto-approved" when a leave is stamped without manager review.
- In-app Notification "Leave approved" whenever a manager (or dashboard) approves.
- In-app Notification "Leave request awaiting decision" or "Leave request flagged for review" from the AI decision service.

### Frontend surface
- Employee Self-Service: the Apply Leave tab (`MyLeaveRequest` component, page `ApplyLeave.jsx`) — shows the balance strip, application form, monthly-usage popup, and personal history.
- HR / admin: the Leave Management page (`LeaveManagement.jsx`) — pending queue, all-requests filter, per-employee balance overview, quota-policy editor, and manual balance adjustment.
- Employee Dashboard also surfaces a summary tile via `GET /leave/dashboard-summary/{employee_id}`.

### Related endpoints
- `POST /leave/apply` — submit a day-based leave request.
- `POST /leave/apply-permission` — submit an hourly permission request.
- `GET /leave/decide/{token}?action=approve|reject` — one-shot approver link from the email.
- `PATCH /leave/{id}/approve` — approve from HR dashboard (RBAC-gated).
- `PATCH /leave/{id}/reject` — reject from HR dashboard (RBAC-gated).
- `PATCH /leave/{id}/cancel` — employee cancels own leave (refunds balance if already approved).
- `GET /leave/pending` — pending queue for HR.
- `GET /leave/all` — filterable, paginated history for HR.
- `GET /leave/my-requests` — employee's own leave history.
- `GET /leave/my-permissions` — employee's own permission history.
- `GET /leave/balance/{employee_id}` — remaining quota per type for a year.
- `GET /leave/balances/all` — every active employee's balance for a year.
- `PATCH /leave/balance/{employee_id}/adjust` — manual HR credit/debit with audit trail.
- `GET /leave/balance/{employee_id}/adjustments` — audit trail for that employee.
- `GET /leave/dashboard` — pending/approved/rejected/on-leave-today counters.
- `GET /leave/dashboard-summary/{employee_id}` — per-employee summary cards.
- `GET|POST|PATCH|DELETE /leave/quota-policies` — HR-managed quota policies.
- `GET /leave/quota-policies/resolve/{employee_id}` — debug helper showing which policy applies.
- `POST /leave-ai/preview` — AI verdict for a hypothetical leave (used by the form).
- `POST /leave-ai/evaluate/{id}` — evaluate an existing request, optionally stamp the decision.
- `GET /leave-ai/recommendations` — manager queue with AI verdicts.
- `POST /leave-ai/bulk-auto-approve` — sweep and apply AI decisions.

### Related database tables
- `leave_request`
- `leave_balance`
- `leave_balance_adjustment`
- `leave_quota_policy`
- `notification`
- `holiday_calendar`
- `task_assignment`
- `employee`

### Frequently-asked-question hints
- How many casual leaves do I get per year?
- How do I apply for a sick leave?
- Why does the system say I need a reason for my leave?
- Can I take a half-day leave?
- I already took one leave this month, why is a popup asking me to confirm before submitting another?
- Who approves my leave request?
- Can I cancel a leave that is already approved, and will I get the days back?
- How do I check how many earned leaves I have left?
- Am I allowed to apply for maternity leave?
- What is the difference between a permission and a leave?
- How long can a permission be, and does it reduce my leave balance?
- What happens if I apply for more leave than I have balance for?

---

## Module: Permission

### What it does
Permission is short, hour-based time-off inside a working day — for example, a two-hour dentist visit or leaving early to pick up a child. You pick the date, tell the system how many hours you need and why, and your manager gets an email to approve or reject. Permissions do not touch your Casual, Sick, Earned or Maternity balance because they are tracked in hours, not days. The system can also file a permission automatically when biometric or ESS login shows you arrived late past the office grace period.

### Who can use it
- Employees file permissions for themselves through the ESS "Permission" tab.
- HR / admin (holding leave.view.all, leave.approve, leave.decide or leave.reject) can view every request, approve or reject from the Leave Management dashboard, and submit a permission on behalf of any employee.
- Managers act on the request from the approval email button, without any login.

### How it works
1. Employee opens the ESS dashboard, switches to the "Permission" tab, and submits date, hours and reason.
2. Backend validates hours (greater than 0, at most 8), reason, and checks for an overlapping pending/approved permission on the same date.
3. A row is written to leave_request with LEAVE_TYPE='PERMISSION', DAYS=0, DURATION_HOURS=hours, STATUS='PENDING_APPROVAL', a fresh approval token and PERMISSION_SUBTYPE (defaults to SHORT_PERMISSION).
4. An approve/reject email is dispatched to APPROVER_EMAIL (fallback ADMIN_EMAIL) using the same template as day-based leave.
5. The manager clicks Approve or Reject in the email (or uses the Leave Management dashboard). Status becomes APPROVED or REJECTED, the approval token is invalidated, and the employee receives a decision email.
6. LATE_COMING variant: at ESS login, if login time is later than office start plus the configured late-grace minutes, the system auto-creates a PENDING_APPROVAL permission with subtype LATE_COMING, duration equal to the hours late, and an auto-written reason describing the cutoff. The same idempotency guard prevents a second row for the same day.

### Business rules
- LEAVE_TYPE='PERMISSION' rows are stored in leave_request with DAYS=0 and DURATION_HOURS set, so they never deduct from CASUAL / SICK / EARNED / MATERNITY quotas.
- DURATION_HOURS must be greater than 0 and no more than 8; anything longer must go through half-day or full-day leave.
- REASON is mandatory on every permission request.
- Allowed PERMISSION_SUBTYPE values: SHORT_PERMISSION (default, manual), HALF_DAY (default 4h), LATE_COMING (auto at login), EARLY_EXIT (auto at logout).
- Only one PENDING_APPROVAL or APPROVED permission is allowed per employee per date; a second submission for the same date is rejected with a 409.
- An employee can only submit a permission for themselves; admin/HR can submit on behalf of anyone.
- POST /leave/apply refuses LEAVE_TYPE='PERMISSION' and directs the caller to POST /leave/apply-permission.
- LATE_COMING is only auto-created when minutes late exceed the configured late_grace_minutes; within grace, no permission is written.
- The auto-create call is best-effort — if the write fails, login still succeeds.
- Idempotency: auto_create_permission refuses to write a second row if a PENDING/APPROVED/REJECTED permission with the same subtype already exists for that employee and date.
- Cancellation follows the same rules as leave: only the owner (or admin) can cancel, and only while the row is PENDING_APPROVAL or APPROVED.
- The employee's monthly star rating loses 0.25 stars per approved permission hour that month (4 hours = 1 star lost).

### Approval workflow
Every permission goes through manager review — there is no auto-approve path.
1. Row is created as PENDING_APPROVAL with a one-time APPROVAL_TOKEN.
2. Email with Approve / Reject buttons is sent to the configured approver (APPROVER_EMAIL, else ADMIN_EMAIL).
3. Approver either clicks the email link (GET /leave/decide/{token}?action=approve|reject) or acts from the Leave Management dashboard (PATCH /leave/{id}/approve or /reject).
4. On approve: STATUS becomes APPROVED, APPROVAL_RESOLVED_AT is stamped, token is cleared, and a decision email plus an in-app notification are raised. Because DAYS=0, no leave balance is deducted.
5. On reject: STATUS becomes REJECTED with the given REJECTION_REASON (defaults to "Rejected by approver" / "Rejected from dashboard"), token is cleared, and a rejection email is sent.

### Automation
- On employee ESS login, if login time is past office start + late_grace_minutes, a LATE_COMING permission is auto-created with duration equal to hours late. The office start time and grace minutes are configured via /settings/office-hours and /settings/attendance-grace.
- EARLY_EXIT is designed to be auto-created at logout when the employee leaves before end-of-day minus the early-exit grace window.
- No scheduled cron runs the permission module — everything is event-driven (submission, decision, login, logout).

### Notifications sent
- Manager email (subject "[BVC24] Leave request — {name} (PERMISSION, 0 day(s))") with Approve / Reject buttons, delivered to APPROVER_EMAIL on submission.
- Employee decision email (subject "[BVC24] Leave Approved" or "Leave Rejected") after the manager acts.
- In-app "Leave approved" notification (TYPE=INFO, bell icon) on approval via email or dashboard.
- Push notification "Late login: {name}" (TYPE=WARNING) raised to admins when a late login triggers the auto LATE_COMING flow.

### Frontend surface
- ESS: Employee Dashboard → "Permission" tab, rendered by the MyPermissionRequest component.
- HR / admin: Leave Management page (frontend/src/pages/LeaveManagement.jsx) — pending permissions appear in the same queue as day leave, marked with the clock icon.

### Related endpoints
- POST /leave/apply-permission — employee submits an hourly permission request.
- GET /leave/my-permissions?employee_id=... — the employee's own permission history.
- GET /leave/dashboard-summary/{employee_id} — includes APPROVED_PERMISSIONS_THIS_MONTH.
- GET /leave/pending?vendor_id=... — admin queue that also lists PERMISSION rows.
- GET /leave/all?leave_type=PERMISSION — filterable admin history.
- GET /leave/decide/{token}?action=approve|reject — email-button target, token-protected.
- PATCH /leave/{leave_id}/approve — admin approves from the dashboard.
- PATCH /leave/{leave_id}/reject — admin rejects from the dashboard.
- PATCH /leave/{leave_id}/cancel — employee cancels their own pending or approved permission.
- GET /settings/attendance-grace, PATCH /settings/attendance-grace — read/write the LATE_COMING and EARLY_EXIT grace minutes.

### Related database tables
- leave_request
- employee
- notification
- vendor

### Frequently-asked-question hints
- How do I apply for a two-hour permission tomorrow?
- Does taking a permission cut my casual leave balance?
- What is the maximum permission I can request in one shot?
- Why did a LATE_COMING permission show up on my dashboard when I only logged in a little late?
- Can I cancel a permission after my manager has approved it?
- Who approves my permission request?
- Why can't I file two permissions on the same day?
- Does the reason field have to be filled in for a permission?
- How many permission hours did I take this month?
- Can HR file a permission on my behalf?
- How does a permission affect my monthly star rating?
- What is the office grace period before a LATE_COMING permission is auto-created?

---

## Module: Payroll

### What it does
Payroll turns each employee's attendance, approved leave, completed tasks and star rating into a monthly payslip that shows earnings, deductions and a final take-home amount. HR can generate a full monthly run for every active employee at once, or create/edit one payslip for one employee. Every employee gets an in-app notification the moment their payslip is generated and can view or download the PDF from their portal.

### Who can use it
- Employees (self-service): view and download their own payslips through the Employee Portal.
- HR / Admin: generate runs, edit individual slips, finalize the run, mark slips as PAID, submit slips to Payroll Records, export CSV, delete DRAFT slips, and maintain salary structures.
- Paid slips are protected from deletion — the payment has to be undone first.

### How it works
1. HR opens the Payroll page and picks a year and month.
2. The system finds (or creates) the PayrollRun for that vendor, year and month; if a DRAFT run already exists it is refreshed.
3. Working days for the month are read from the Holiday Calendar (Sundays and declared holidays excluded); if the table is empty for that month the fallback is "Sundays only off". HR can override the number.
4. For every ACTIVE employee the engine pulls attendance rows, approved leave, completed tasks and the star performance score for that month.
5. It prorates every earnings component (Basic, HRA, DA, Conveyance, Medical, Special, Other, Bonus, Incentives) by paid days / working days, adds task bonus and star bonus, computes statutory deductions (PF, ESI, Professional Tax), subtracts late-penalty, and stores the final Gross / Deductions / Net on the slip.
6. HR can also use the "Generate for one employee" flow — in that path HR types the earnings and deductions numbers manually; the backend just totals them and stores the slip.
7. HR finalizes the run to lock it, then marks either the whole run or individual slips as PAID.
8. When a slip is generated for an employee, a notification is written to their inbox with the net-pay amount and a pointer to the Payslips tab.

### Business rules
- Working days: pulled from the Holiday Calendar; when unset, defaults to 26 for one-off slips or "Sundays only off" for the full run.
- Per-day rate = Base Salary / Working Days.
- Paid days = Days Present + (Days Half × 0.5) + Paid Leave Days.
- Earn ratio = Paid days / Working days. Every earnings component is multiplied by this ratio to get the prorated (earned) amount for the month.
- Absent days = max(0, Working days − (Present + 0.5 × Half-day + Paid leave + Unpaid leave)).
- Paid leave types: CASUAL, SICK, EARNED, PAID. Unpaid leave types: UNPAID, LOP. Unknown leave types default to paid.
- Task bonus = tasks_completed × ₹100 per task (default; overridable per run). Tasks counted are those with status COMPLETED or DONE updated within the pay month.
- Star bonus = OVERALL_STARS × ₹500. A 5-star employee earns +₹2,500 for that month.
- Late penalty = Days Late × ₹50 per day (default; overridable per run).
- Absence deduction (one-employee flow): if the frontend does not post it, the backend derives (Earned Basic ÷ Working Days) × Absent Days. This is added to Total Deductions, but Basic is posted as the full contractual salary — not reduced — so absence is not double-counted.
- PF (Provident Fund): employee = 12% of (Basic + DA), where (Basic + DA) is capped at ₹15,000/month; employer contributes the same amount. Only applied when PF_APPLICABLE is set on the salary structure.
- ESI (Employees' State Insurance): applies only when monthly gross ≤ ₹21,000. Employee = 0.75%, employer = 3.25%. Zero when gross exceeds the ceiling.
- Professional Tax: state-slab based. Tamil Nadu slabs range from ₹0 (≤ ₹21,000) up to ₹1,250/month (> ₹75,000). Karnataka, Maharashtra and West Bengal have their own slabs; unknown state or no state = ₹0 PT.
- Gross Pay = Earned Basic + HRA + DA + Conveyance + Medical + Special + Other Allowances + Annual Bonus + Incentives + Task Bonus + OT Pay + Star Bonus.
- Total Deductions = PF (employee) + ESI (employee) + Professional Tax + Late Penalty + Other Deductions + Absence Deduction.
- Net Pay = Gross − Total Deductions.
- OT Pay is a reserved field and always 0 until an OT rate is configured.
- Employer PF and Employer ESI are stored for reference only — they are not subtracted from net pay.
- Run status flow: DRAFT → FINALIZED → PAID. Slip status flow: PENDING → SUBMITTED → PAID.
- Only DRAFT runs can be regenerated in place; only DRAFT runs can be deleted; only FINALIZED runs can be marked PAID.
- PAID slips cannot be deleted.
- Submitting a slip that is already SUBMITTED just returns the existing timestamp. Submitting a slip that is already PAID keeps its PAID status but still records when it was submitted.
- Salary structures store the monthly Basic, allowances, PF_APPLICABLE, ESI_APPLICABLE and PT_STATE (default TAMIL_NADU); one row per employee. When no structure exists, Employee.SALARY is treated as 100% Basic with PF, ESI and Tamil Nadu PT all applicable.
- Regenerating a DRAFT run wipes and re-inserts every slip in that run.

### Approval workflow
No multi-step approval. HR alone controls the lifecycle: generate → finalize → mark paid. The run cannot skip states — attempting to mark a DRAFT run as PAID is rejected.

### Automation
None — payroll generation is manual. HR triggers the run each month.

### Notifications sent
- Type INFO, title "New payslip — {Month} {Year}", body "Your {Month} {Year} payslip has been generated. Net pay: INR {amount}. View it in Employee Portal -> Payslips." Sent to the individual employee the moment their single-employee payslip is generated.

### Frontend surface
- Employee Portal: "Payslips" tab (list, tile summary, on-screen preview, download PDF).
- HR Admin: "Payroll" module (generate run, edit slip, finalize, mark paid, delete draft, CSV export, run summary/reports).
- HR Admin: "Payroll Records" page (flat list of every slip with search, filters and status tiles).
- HR Admin: "Salary Structure" editor per employee (with a statutory-deduction preview).

### Related endpoints
- POST /payroll/generate — build or refresh a monthly run for all active employees.
- POST /payroll/generate-for-employee — create or update one slip for one employee.
- GET /payroll/runs — list all runs for a vendor.
- GET /payroll/runs/{id} — one run with all slips.
- GET /payroll/runs/{id}/slip/{employee_id} — one employee's slip in that run.
- GET /payroll/runs/{id}/slip/{employee_id}/pdf — payslip PDF.
- GET /payroll/runs/{id}/summary — by-department, by-designation and by-status totals.
- GET /payroll/runs/{id}/export.csv — CSV export of every slip in the run.
- PATCH /payroll/runs/{id}/finalize — lock a DRAFT run.
- PATCH /payroll/runs/{id}/mark-paid — mark a FINALIZED run as PAID.
- DELETE /payroll/runs/{id} — delete a DRAFT run (and its slips).
- PATCH /payroll/slips/{id}/submit — publish a slip to Payroll Records (PENDING → SUBMITTED).
- PATCH /payroll/slips/{id}/mark-paid — mark a single slip PAID.
- DELETE /payroll/slips/{id} — delete a non-PAID slip.
- GET /payroll/records, GET /payroll/records/summary — flat records list + tile summary.
- GET/PUT/DELETE /payroll/salary-structures/{employee_id} — salary structure CRUD (with statutory preview).
- GET /my-payslips, /my-payslips/summary, /my-payslips/{id}/pdf — employee self-service.

### Related database tables
- PayrollRun
- PayrollSlip
- SalaryStructure
- Employee
- Attendance
- LeaveRequest
- TaskAssignment
- PerformanceScore
- HolidayCalendar
- Role
- Department
- Designation
- Vendor
- Notification
- CompanyMaster

### Frequently-asked-question hints
- When will my payslip for this month be ready?
- How is my net pay calculated?
- Why is my salary lower this month — how does absence get deducted?
- How much PF and ESI is being cut from my salary and why?
- What is professional tax and how much is it in Tamil Nadu?
- Where do I download my payslip PDF?
- How is the star bonus added to my payroll?
- Why did I get a late-penalty deduction?
- How are paid and unpaid leaves treated in my payslip?
- What do the statuses DRAFT, FINALIZED, PAID, PENDING and SUBMITTED mean on my payslip?
- Can HR still change my payslip after it is marked PAID?
- How is the number of working days for the month decided?

---

## Module: Allowance

### What it does
The Allowance module lets you file expense claims for money you spent on company work — travel, food, fuel, client meetings and similar things — and get reimbursed once the MD approves. You enter the amount and date, attach a receipt photo or PDF, and the MD sees the claim in the admin queue. You get a notification the moment it is approved or rejected, including any note the MD wrote.

### Who can use it
- Any employee can submit their own claims and view the status of claims they have filed (employee-facing / ESS).
- The MD (the person configured as `APPROVER_EMAIL` or `ADMIN_EMAIL`) approves or rejects claims from the admin Allowances page (HR/admin-facing).
- Admins can list the full pending queue across all employees.

### How it works
1. From the ESS "My Allowance" section, the employee picks a category, enters an amount and expense date, optionally adds a description, and submits. The row is created with STATUS = PENDING and SUBMITTED_AT stamped to now.
2. Optionally, the employee uploads a receipt file for that claim; the file is stored under `/static/allowances/<claim id>/` and its URL is saved on the row.
3. On submit, an email alert is fired to the MD (only if SMTP is configured and an approver email is set) showing the employee's name, code, category, amount, expense date and description, with a link cue to open the admin Allowances page.
4. The MD opens the admin Allowances page, reviews the pending claims, and calls the decide action with either APPROVE or REJECT. They can add a REVIEW_NOTES message explaining the decision.
5. The system flips STATUS to APPROVED or REJECTED, stamps REVIEWED_AT and REVIEWED_BY_ID, and stores REVIEW_NOTES.
6. A Notification row is written for the employee — SUCCESS type on approval, WARNING type on rejection — so the employee sees a bell entry and the WhatsApp-style toast on their next poll. The MD's REVIEW_NOTES is embedded verbatim inside the message so the employee reads exactly what the reviewer wrote.

### Business rules
- The category must be one of these nine values: TRAVEL, FOOD, ACCOMMODATION, OFFICE_SUPPLIES, FUEL, COMMUNICATION, CLIENT_MEETING, TRAINING, OTHER. Any other value is rejected.
- Amount must be greater than zero.
- Expense date is required.
- Description is optional; blank values are stored as empty.
- A new claim is always created with STATUS = PENDING.
- The employee identifier accepted on submit can be either the internal UUID or the EMPLOYEE_CODE (for example "EMP105"); the portal sends the code from localStorage while admin flows send the UUID.
- A claim can only be decided once — if it is not still PENDING when the MD acts, the request is refused with an "already <status>" error.
- The decide action only accepts APPROVE or REJECT; anything else is refused.
- On decision, REVIEWED_AT is set to the moment of the decision, REVIEWED_BY_ID is stored, and REVIEW_NOTES is trimmed (blank becomes empty).
- Receipt uploads only accept these file types: .png, .jpg, .jpeg, .pdf, .webp. Any other extension is refused.
- Uploaded receipts are stored under `static/allowances/<claim id>/<random 10-char name><ext>` and the URL is saved on the claim.
- The MD notification email is best-effort: if SMTP is not configured or no approver email is set, no email is sent and the submit still succeeds.
- The employee notification write is best-effort: if it fails, the approval/rejection itself is not rolled back.
- The notification MESSAGE is truncated to 500 characters.
- Amounts are shown in Indian rupees (`INR` in email, `₹` in notification), formatted with thousands separators and two decimals.

### Approval workflow
Single-step approval by the MD. Every claim goes to PENDING on submit and stays there until the MD approves or rejects it. There is no auto-approve, no escalation, and no secondary approver. Once decided, the claim is locked — it cannot be re-decided.

### Automation
None. There is no cron job or scheduled task in this module. Every state change is driven by an employee submitting or the MD deciding.

### Notifications sent
- On submit: HTML alert email to the MD (`APPROVER_EMAIL`, falling back to `ADMIN_EMAIL`) with employee name, code, category, amount, expense date and description. Sent only when SMTP is configured.
- On approve: in-app Notification to the employee, title "Allowance approved", type SUCCESS, message "<amount> · <category> — approved" plus the MD's REVIEW_NOTES verbatim if present.
- On reject: in-app Notification to the employee, title "Allowance rejected", type WARNING, message "<amount> · <category> — rejected" plus the MD's REVIEW_NOTES verbatim if present.

### Frontend surface
- Employee (ESS): "My Allowance" section on the Employee Dashboard, rendered by `MyAllowanceSection.jsx`.
- HR/Admin: the "Allowances" page (`Allowances.jsx`) in the admin dashboard, which shows the pending queue and the approve/reject actions.

### Related endpoints
- `GET /allowances` — list allowances; optional `employee_id` to scope to one person, optional `status` filter.
- `POST /allowances` — submit a new expense claim.
- `PATCH /allowances/{allowance_id}/decide` — MD approves or rejects.
- `POST /allowances/{allowance_id}/upload-receipt` — attach a receipt file to a claim.
- `GET /allowances/summary` — dashboard tile counts and totals (total, pending, approved, rejected, approved amount, pending amount); optional `employee_id` to scope.

### Related database tables
- `employee_allowance`
- `employee`
- `notification`

### Frequently-asked-question hints
- How do I claim my travel expenses?
- What categories can I file an expense under?
- Can I upload a photo of my petrol bill as the receipt?
- Which file types are allowed for a receipt?
- Why is my allowance still pending?
- Who approves my expense claim?
- Where do I see the reason if my claim was rejected?
- Can I edit or resubmit a claim after the MD has decided?
- Is there a maximum amount I can claim?
- How will I know when my claim is approved?
- What currency are allowances paid in?
- Where do I check the total amount I have been approved for this month?

---

## Module: Memos

### What it does
Memos are the formal HR record for warnings, appreciations, disciplinary notes, information notices, customer complaints and show-cause notices. Employees see every memo issued to them, can open the attachment, and mark it acknowledged. HR uses the same records as an audit trail, and the system itself issues warning and appreciation memos automatically each week and each month based on attendance and task data.

### Who can use it
- Employees see only their own memos and can acknowledge them. Any non-admin caller is forced onto their own employee record; attempts to view another person's memos return 403.
- HR/admin roles create, edit, close, cancel, soft-delete, export and run automation. Endpoints are gated by permission codes: `memo.create`, `memo.view.all`, `memo.update`, `memo.delete`, `memo.export`. Admin-level roles (ADMIN, SUPER_ADMIN, HR, MANAGER, PRODUCTION_HEAD, MANAGING_DIRECTOR, HR_MANAGER, SALES_MANAGER, PURCHASE_MANAGER, PRODUCTION_MANAGER, INVENTORY_MANAGER, ACCOUNTS_MANAGER) see global stats; everyone else sees only their own.

### How it works
1. HR opens the Memos page, picks an employee, chooses a type (Warning, Appreciation, Disciplinary, Information, Customer Complaint, Performance Recognition, Show Cause Notice), fills in subject/description/severity and optionally attaches a file.
2. The system assigns a memo number in the format `MEMO-YYYY-NNNN` (counter resets each calendar year), saves the attachment under `/static/memos/<uuid>.<ext>`, and stores the record with `STATUS=ACTIVE` and `ISSUE_DATE` defaulting to today.
3. A notification row is written to the employee. Warning-style memos (WARNING, SUSPENSION, TERMINATION) use the `WARNING` toast tone; everything else uses `INFO`.
4. The employee sees the memo in the ESS "Memos" tab, opens it, and taps Acknowledge. That flips `ACKNOWLEDGED_BY_EMPLOYEE` to 1 and stamps `ACKNOWLEDGED_DATE`. Optional acknowledgement remarks get appended to the REMARKS field prefixed with `[Ack]:`.
5. Automations run on their own schedule and drop memos into the same table with `IS_AUTOMATED=1` and a stable `AUTOMATION_KEY` so reruns are safe.

### Business rules
- Memo type must be one of: WARNING, APPRECIATION, DISCIPLINARY, INFORMATION, CUSTOMER_COMPLAINT, PERFORMANCE_RECOGNITION, SHOW_CAUSE_NOTICE.
- Severity must be one of: LOW, MEDIUM, HIGH, CRITICAL. Default on create is LOW.
- Status must be one of: ACTIVE, CLOSED, CANCELLED. Default on create is ACTIVE.
- Memo numbers follow `MEMO-YYYY-NNNN`, 4-digit zero-padded, sequence restarts each calendar year, and manual and automated memos share one continuous sequence.
- Delete is soft only. The row stays; `DELETED_AT` is timestamped and the row disappears from default lists (an `include_deleted=true` flag re-shows it).
- A deleted memo cannot be edited, closed, cancelled or acknowledged.
- Subject is capped at 200 characters, description at 4000, remarks at 2000, issued-by at 100, attachment original filename at 255.
- Acknowledgement is idempotent: acknowledging an already-acknowledged memo returns the original acknowledged date without changing anything.
- Weekly automation warning triggers (any one is enough, evaluated over the previous ISO Mon-Sun week): more than 1 absent day, more than 2 late marks, or more than 1 overdue task. Severity escalates to HIGH when absent days exceed 2 or overdue tasks exceed 3.
- Weekly automation appreciation triggers (all must be true): 0 absent days, 0 late marks, 0 overdue tasks, and at least 1 assigned task in the week.
- Monthly automation warning triggers (any one is enough): 5 or more late arrivals, 1 or more unpaid absences, or 5 or more missed check-outs in the month. Severity escalates to HIGH when unpaid absences reach 3 or late arrivals reach 10.
- Monthly automation appreciation triggers (all must be true): 0 late arrivals, 0 unpaid absences, and at least 1 day present.
- Automated memos carry `ISSUED_BY = "System (Automation)"` (weekly) or `"System (AI Monthly Automation)"` (monthly). The monthly memo's `ISSUE_DATE` is set to the last day of the evaluated month; the weekly memo's is the Sunday that closes the week.
- Automation is idempotent. Weekly key: `AUTO-WEEK-<isoyear>W<isoweek>-<type>-<employee_id>`. Monthly key: `AUTO-MONTH-<YYYY-MM>-<type>-<employee_id>`. If the key already exists the run is a no-op for that employee.
- Only employees with `STATUS=ACTIVE` are evaluated by either automation.
- If both warning and appreciation rules match in the weekly run, warning wins.

### Approval workflow
None. A memo is a one-way notice from HR; there is no reviewer or escalation queue. The only employee-side action is acknowledgement, which does not require approval and does not change the memo's status.

### Automation
- Weekly scheduler: fires every Monday at 06:00 local server time, evaluates the previous Monday-to-Sunday ISO week for every ACTIVE employee, writes warning/appreciation memos plus notifications, and skips any employee already keyed for that week. A 48-hour cooldown prevents duplicate runs after restarts or manual triggers.
- Monthly scheduler: fires on the 1st of each month at 06:00 local server time, evaluates the previous calendar month for every ACTIVE employee, and writes AI-personalised memos. A 20-day cooldown protects against restart-triggered reruns.
- Monthly memo text is generated by Gemini (`gemini-2.5-flash`) when `GEMINI_API_KEY` is set. The prompt supplies the employee's name, code, and the exact numbers, and asks for a subject and body separated by `|||`. If Gemini is unavailable, returns unusable text, or produces a body under 80 characters, the system falls back to a fixed template so a memo is always issued.
- Both automations can also be triggered on demand from the HR UI, which calls the same evaluator functions.

### Notifications sent
- On manual memo create: one Notification to the recipient, `TYPE=WARNING` for WARNING/SUSPENSION/TERMINATION types, else `TYPE=INFO`, title `"New <Type> memo"`, message `"<MEMO_NUMBER> — <subject>"`.
- On weekly automation memo: Notification with `TYPE=WARNING` or `SUCCESS`, title `"Warning memo issued"` / `"Appreciation memo issued"`, `REF_TYPE=MEMO`, `REF_ID=memo.ID`.
- On monthly automation memo: Notification with `TYPE=WARNING` or `SUCCESS`, title `"New warning memo"` / `"New appreciation memo"`, `REF_TYPE=MEMO`, `REF_ID=memo.ID`.

### Frontend surface
- ESS: "Memos" tab in the employee dashboard, rendered by `MyMemosPanel.jsx` — lists the employee's memos with acknowledge action.
- HR admin: `EmployeeMemos.jsx` page — full list with filters, search, CSV export, create/edit/close/cancel/soft-delete, and the automation-run controls.

### Related endpoints
- `POST /memos` — Create a memo (multipart, optional attachment).
- `GET /memos` — List memos with filters (employee, type, severity, status, date range, search, paging).
- `GET /memos/stats` — Counters for dashboard tiles: total, active, closed, warnings, appreciations, disciplinary_open, pending_acknowledgement, last_memo_date.
- `GET /memos/{id}` — Single memo detail (recipient or admin only).
- `PATCH /memos/{id}` — Update subject/description/severity/status/issued-by/issue-date/remarks.
- `DELETE /memos/{id}` — Soft delete (sets `DELETED_AT`).
- `POST /memos/{id}/close` — Set status to CLOSED.
- `POST /memos/{id}/cancel` — Set status to CANCELLED.
- `POST /memos/{id}/acknowledge` — Employee acknowledges receipt.
- `GET /memos/employee/{employee_id}` — All memos for one employee (accepts UUID or EMPLOYEE_CODE).
- `GET /memos/export/csv` — CSV download of the filtered set.
- `POST /memos/automation/run` — Admin triggers weekly automation now.
- `GET /memos/automation/last-run` — Summary of the last weekly run.
- `POST /memos/automation/run-monthly` — Admin triggers monthly automation for a `YYYY-MM`.
- `GET /memos/automation/last-monthly-run` — Summary of the last monthly run.

### Related database tables
- `employee_memos`
- `employees`
- `notifications`
- `settings` (holds `memo_automation.last_run` and `memo_automation.last_monthly_run` markers)
- `attendance` and `task_assignments` (read by the weekly evaluator)

### Frequently-asked-question hints
- "Why did I get a warning memo this month?"
- "How many times can I be late before HR issues a warning?"
- "How do I acknowledge a memo?"
- "Can HR delete a memo I already received?"
- "Who sends the appreciation memos — is it automatic?"
- "When does the memo automation run?"
- "Where can I download the attachment on my memo?"
- "What does memo number MEMO-2026-0001 mean?"
- "I got a memo but I disagree — is there an appeal?"
- "How do I see all memos issued to me?"

---

## Module: Announcements

### What it does
Announcements are HR-authored posts that appear on every employee's Announcements panel. HR uses them to share meetings, events, holiday schedules, safety notices, IT downtime, achievements, urgent alerts, and general company updates. When HR posts an announcement, every active employee in the same vendor gets a matching notification in their bell so they see it without opening the panel.

### Who can use it
- Every logged-in employee can read announcements posted for their vendor (list view is open to the whole company).
- Creating, editing, and deleting announcements requires the `announcement.manage` permission, held by HR / ADMIN / SUPER_ADMIN roles.
- Only ADMIN and SUPER_ADMIN callers can pass a different `vendor_id` on the list endpoint to inspect another vendor's announcements; for everyone else the vendor is silently forced to their own.

### How it works
1. HR opens the admin Announcements page, picks a type, enters a title, and optionally fills description, event date (YYYY-MM-DD), event time (HH:MM), and location.
2. On save, one row is written to the `announcement` table under the HR user's vendor, marked active.
3. The backend then looks up every employee in that vendor whose STATUS is ACTIVE and inserts one Notification row per employee, backlinked to the announcement (REF_TYPE = ANNOUNCEMENT, REF_ID = announcement id).
4. Employees see the new item in their Announcements panel and a coloured toast/dot on their bell.
5. If HR edits the post, the announcement row is updated in place. If HR deletes it, the announcement is soft-deleted (IS_ACTIVE = 0) and every notification that was fanned out for it is hard-deleted so bells clear immediately.

### Business rules
- Twelve announcement types are accepted: GENERAL, HR, MEETING, EVENT, HOLIDAY, SAFETY, IT, ACHIEVEMENT, OPERATIONAL, URGENT, COMMUNICATION, CORPORATE. NOTICE is kept as a legacy alias and treated as GENERAL.
- Only three types carry a scheduled date/time: MEETING, EVENT, HOLIDAY. All other types are dateless.
- TITLE is required and cannot be empty; it is trimmed and capped at 200 characters.
- DESCRIPTION is optional, trimmed, capped at 2000 characters; blank becomes null.
- EVENT_DATE must be in YYYY-MM-DD format or the save is rejected with a 400 error.
- EVENT_TIME is a free-form string capped at 10 characters (HR can leave it blank when the time is TBD).
- LOCATION is optional, trimmed, capped at 200 characters.
- Announcements never cross vendors. The vendor is read from the creator's JWT on create; the list endpoint always filters by the caller's vendor unless an admin explicitly asks to view another.
- The list returns newest-first by creation time and is capped at 500 rows per request.
- The `upcoming_only` filter hides dated rows whose EVENT_DATE is before today; dateless rows are always kept in.
- The `include_inactive` filter is off by default, so soft-deleted rows do not show up in either the ESS panel or the HR list unless explicitly requested.
- Delete is always a soft delete (IS_ACTIVE flipped to 0). There is no hard-delete endpoint.
- The notification fan-out is best-effort — if it fails, the announcement itself is still saved.

### Approval workflow
None. Any HR/admin user with the `announcement.manage` permission can post directly. There is no reviewer, no draft state, no auto-approve step.

### Automation
None. There is no cron job, scheduler, or auto-trigger for announcements. Every post, edit, and delete is a manual HR action.

### Notifications sent
When an announcement is created, one Notification is written per active employee in the vendor. The notification's colour band is chosen from the announcement type:
- URGENT and SAFETY announcements produce WARNING-band notifications (amber toast + bell dot) so they stand out.
- ACHIEVEMENT announcements produce SUCCESS-band notifications.
- Every other type produces a normal INFO notification.

The notification title reads `<Type Label>: <first 80 chars of the title>` (HR and IT stay uppercase, other labels are title-cased). The message stitches together the title, event date (formatted `DD Mon YYYY`), event time, and location where present, capped at 500 characters. Each notification is backlinked to the announcement so when HR deletes the post, the matching bell entries are removed for every employee in the vendor.

No SMS, WhatsApp, or email is sent — the announcement channel is the in-app notification only.

### Frontend surface
- Employee side: the "Announcements" panel/tab on the ESS home dashboard, backed by `MyAnnouncementsPanel.jsx` and the standalone `Announcements.jsx` page in the sidebar.
- HR / admin side: the HR Announcements admin page where posts are created, edited, and removed.

### Related endpoints
- `GET /announcements` — list announcements for the caller's vendor (filters: `type`, `upcoming_only`, `include_inactive`, admin-only `vendor_id`).
- `POST /announcements` — create an announcement and fan out notifications (requires `announcement.manage`).
- `PATCH /announcements/{id}` — edit an existing announcement (requires `announcement.manage`).
- `DELETE /announcements/{id}` — soft-delete an announcement and remove its spawned notifications (requires `announcement.manage`).

### Related database tables
- `announcement`
- `notification`
- `employee`
- `vendor`

### Frequently-asked-question hints
- How do I see the latest company announcements?
- Who is allowed to post an announcement?
- Why did I get an amber warning notification — is it urgent?
- Will I be notified when HR posts a meeting or event?
- What happens if HR cancels an announcement I already saw in my bell?
- What types of announcements can HR post — is there a holiday or safety category?
- Do announcements go to other branches or only my company?
- Can I filter announcements to only upcoming meetings and events?
- Why does an old announcement still show up even though it has no date?
- Do announcements get sent by SMS, email, or WhatsApp?

---

## Module: Notifications

### What it does
Notifications are the short, in-app alerts you see in the bell icon at the top of the HRMS and in the toast pop-ups that slide in when something happens. They tell you when your payslip is out, a leave decision has been made, a memo or allowance is issued, an announcement is posted, or the system needs to flag a problem. Each notification is tied to you personally and can link straight back to the record it is about.

### Who can use it
- Every logged-in employee sees only their own notifications through the bell dropdown and toast.
- HR / Admin users additionally see the system-generated alerts (low stock, machine down, backlog, end-of-day pending task warnings) because those alerts are created without an EMPLOYEE_ID.
- The full-list "admin/legacy" view (no `employee_id` filter) returns every row in the table and is intended for admin tooling only.

### How it works
1. A module (leave, payroll, allowance, memo, announcement, employee status, task approval, attendance AI, project, inventory, machine) writes a new row into the `notification` table when it does something the employee should know about.
2. That row carries a TITLE, MESSAGE, a TYPE band (INFO / SUCCESS / WARNING / ERROR / ATTENDANCE_ALERT / EMPLOYEE_STATUS), an EMPLOYEE_ID (so only that person sees it), and optionally REF_TYPE + REF_ID so the frontend can deep-link back to the underlying record (e.g. REF_TYPE="MEMO" REF_ID=42, REF_TYPE="ANNOUNCEMENT").
3. The frontend bell polls `GET /notifications?employee_id=…` for the list and `GET /notifications/unread-count?employee_id=…` for the red badge count.
4. Clicking a notification calls `PUT /notifications/{id}/read`; clicking the header "Mark all read" calls `PUT /notifications/mark-all-read?employee_id=…`; the "Clear all" button in the bell dropdown calls `DELETE /notifications?employee_id=…`.
5. If the notification TYPE is WARNING or ERROR, the backend additionally tries to send an email alert — but only if the email-alerts setting is on and SMTP is configured.

### Business rules
- Per-employee scoping is strict. When `employee_id` is passed, only rows where `EMPLOYEE_ID` equals that employee are returned. Rows with `EMPLOYEE_ID IS NULL` (legacy or bug-produced orphans) are deliberately invisible to employees to stop cross-employee leaks.
- The `employee_id` query parameter accepts either the Employee UUID (`Employee.ID`) or the `EMPLOYEE_CODE`; the backend resolves the code to the UUID before filtering.
- The list endpoint returns at most 100 notifications, ordered by `CREATED_AT` descending.
- `CREATED_AT` defaults to `datetime.now()` (server local IST wall-clock), so the "5 minutes ago" text on the frontend matches the actual issue time — this is intentional and different from most other tables' UTC pattern.
- On create, `TYPE` defaults to `INFO` and is stored in upper case.
- Email fan-out fires only for TYPE in `{"ERROR", "WARNING"}`, only when `is_email_alerts_enabled(db)` is true and `is_smtp_configured()` is true. Subject is prefixed `[Bharath ERP]`. Email failures are swallowed (printed) and never break the notification.
- Mark-all-read is scoped per employee when `employee_id` is passed; without it, the endpoint marks every unread row across the database (admin action).
- Bulk delete (`DELETE /notifications`) requires `employee_id`. Calling it without one returns HTTP 400 — this is a deliberate guard so a stray UI call cannot wipe the whole system's notifications.
- Deleting a single notification is unconditional (any caller with the ID can delete it); 404 is returned if the ID does not exist.
- `REF_TYPE` + `REF_ID` are the deep-link handles the frontend uses when a card is clicked (known values in code include `ANNOUNCEMENT` and `MEMO`).
- Deduplication in the system-alert generator uses TITLE + MESSAGE + `IS_READ = 0`: it will not re-create an unread duplicate, but once you mark it read a new copy can appear.

### Approval workflow
Not applicable — notifications carry no approval flow of their own. They are emitted as a side-effect of decisions taken in other modules (leave decision, allowance approval, memo issue, task approval, etc.).

### Automation
- `POST /notifications/generate` produces four kinds of system alerts in one pass:
  - Low-stock WARNING for every inventory item with `QUANTITY <= 10`.
  - Machine-down ERROR for every machine whose `STATUS = "DOWN"`.
  - Backlog INFO once the count of `Task.STATUS = "PENDING"` reaches 10 or more.
  - After 18:00 local time, a per-employee WARNING "End-of-Day Pending Task" for each `TaskAssignment` whose `ASSIGNED_DATE` is today and whose `TASK_STATUS` is not `COMPLETED`. The date is embedded in the message text so the same person will not be re-alerted for the same day, but a fresh alert can fire the next evening.
- Cron scheduling of the endpoint itself is not defined in this file — it is triggered externally.

### Notifications sent
Producers and their bands (observed in the codebase):
- Leave decisions and reminders — `INFO`.
- Allowance decisions — `SUCCESS` if approved, `WARNING` if rejected.
- Payroll — `INFO` (payslip issued).
- Memos — issued through the memo automation service with `REF_TYPE="MEMO"`.
- Announcements — `REF_TYPE="ANNOUNCEMENT"`.
- Employee status changes — TYPE `EMPLOYEE_STATUS`.
- Attendance AI — TYPE `ATTENDANCE_ALERT`.
- Task approvals — `SUCCESS` on approve, `WARNING` on reject.
- Project events — `INFO`.
- Inventory low stock — `WARNING`; machine DOWN — `ERROR`; backlog — `INFO`.

### Frontend surface
- Employees: the bell icon dropdown (unread badge + list + "Mark all read" + "Clear all") and the megaphone-icon toast that pops in when a new notification arrives.
- HR / Admin: admin dashboard consumes the same table for the system-alert stream.

### Related endpoints
- `POST /create-notification` — create a single notification (used by producers).
- `GET /notifications?employee_id=…` — list this employee's notifications (max 100, newest first).
- `GET /notifications/unread-count?employee_id=…` — red-badge count for this employee.
- `PUT /notifications/{notif_id}/read` — mark a single notification as read.
- `PUT /notifications/mark-all-read?employee_id=…` — mark all this employee's unread notifications as read (or all rows if `employee_id` omitted).
- `DELETE /notifications/{notif_id}` — delete one notification.
- `DELETE /notifications?employee_id=…` — clear all notifications for one employee (`employee_id` required, else 400).
- `POST /notifications/generate` — generate low-stock / machine-down / backlog / end-of-day pending-task system alerts.

### Related database tables
- `notification`
- `employee`
- `inventory`
- `machine`
- `task`
- `task_assignment`
- `setting`

### Frequently-asked-question hints
1. Why don't I see any notifications in my bell dropdown?
2. How do I clear all my notifications at once?
3. What does the red number next to the bell icon mean?
4. Will I get an email when there is a warning or error alert?
5. Can I see other employees' notifications?
6. Why did I get an "End-of-Day Pending Task" warning at 6 PM?
7. What triggers a low-stock notification?
8. Do notifications remember whether I have opened them?
9. When I click a memo or announcement notification, where does it take me?
10. Why is my notification timestamp showing local time and not UTC?

---

## Module: Star Performance

### What it does
Star Performance gives every employee a monthly rating out of 5 stars based on four things: attendance, task completion, unpaid leave taken, and permission hours used. The MD uses this rating to decide who to reward, recommend for a promotion, or give an increment to. The overall star score also feeds payroll — it is stamped onto the payslip and drives an extra monthly bonus.

### Who can use it
- **Employees (ESS):** Can view their own monthly stars and history on the "My Performance" panel of the Employee Dashboard.
- **MD / HR admin:** Can view the full org leaderboard, trigger the monthly compute, drill into any employee's score, and record decisions (promotion recommended, increment recommended, rewarded, remarks) on the "Star Performance" HR page.
- **Excluded from scoring:** Employees whose role name is `super_admin`, `admin`, or `system_administrator`. Only employees with STATUS = `ACTIVE` and belonging to the selected vendor are scored.

### How it works
1. For a chosen (year, month), the MD hits "Compute" (or the API is called with `VENDOR_ID`, `YEAR`, `MONTH`).
2. The service pulls every active non-admin employee for that vendor.
3. For each employee, the service reads live data for the month from four tables — Attendance, TaskAssignment, LeaveRequest (unpaid), LeaveRequest (permission) — and computes four dimension scores, each 0.0-5.0 in 0.5 steps.
4. The four dimension stars are averaged with equal 25% weight to produce OVERALL_STARS.
5. Results are written to one PerformanceScore row per employee per month. Re-running the same month overwrites the previous row so the MD always sees fresh data.
6. Employees see their stars in the "My Performance" panel; the MD sees the ranked leaderboard, top-N tile, and per-employee history graph.
7. When payroll is run for that month, `PERFORMANCE_STARS` is copied onto the payslip and `STAR_BONUS = stars * 500` is added to gross and net pay.

### Business rules
- **Four dimensions, equal weight (25% each):** Attendance, Task, Leave, Permission. Weights must sum to 1.0.
- **Attendance stars** = (days_present + half_days x 0.5) / working_days x 5. `PRESENT` and `LATE` count as full days, `HALF_DAY` counts as 0.5.
- **Working days** are Monday-Saturday only (Sundays are off), further reduced by declared holidays for the vendor. Falls back to Sundays-only if the holiday table is empty.
- **Task stars** = on_time_completed / total_assigned x 5. A task counts as on-time if its status is `COMPLETED` or `DONE`, its UPDATED_AT falls inside the month, and it was closed on or before its DUE_DATE (a task with no due date is treated as on-time when completed).
- **Task scope** includes tasks assigned within the month plus any assigned up to 60 days earlier that were completed inside the month. If no tasks were assigned in scope, task stars are 0.
- **Leave stars** = 5 - unpaid_leave_days. Each approved unpaid/LOP day removes 1 star. 5 unpaid days = 0 stars. Paid leave (CASUAL, SICK, EARNED) does not affect the score.
- **Permission stars** = 5 - (permission_hours x 0.25). Each approved permission hour removes 0.25 stars. 4 hours = -1 star, 20 hours = 0 stars.
- **Rounding:** Every star value is snapped to the nearest 0.5 and clamped between 0.0 and 5.0.
- **Overall stars** = 0.25 x (attendance + task + leave + permission), then snapped to the nearest 0.5.
- **Legacy dimensions** (`PRODUCTIVITY_STARS`, `CONSISTENCY_STARS`) are always written as 0.0 in the new system — they exist only for backward compatibility with old UI code.
- **Payroll link:** BONUS_PER_STAR is Rs. 500. A 5-star employee earns +Rs. 2,500 that month on top of their base salary. The bonus is folded into both gross and net pay.
- **Idempotent:** Re-running compute for the same (employee, year, month) overwrites the previous row instead of duplicating.
- **Validation:** MONTH must be between 1 and 12. If a requested vendor has no employees, the compute falls back to Bharath Vending Corporation.

### Approval workflow
No formal approval on the score itself — scores are computed automatically from the underlying attendance, task, and leave data.

The MD (or authorized HR) records three yes/no decisions and a free-text remark against each monthly score using the "action" endpoint:
- Recommended for promotion
- Recommended for increment
- Rewarded (marker that a reward was actually given)
- MD remarks (free text)

These flags are set per-score row and can be toggled at any time.

### Automation
No cron/scheduled job is wired to auto-compute stars. Compute is triggered manually by calling `POST /performance/stars/compute` with the year and month (typically at month-end before payroll is run).

### Notifications sent
No notifications are dispatched from the Star Performance module itself. The score simply becomes visible in the employee's "My Performance" panel and on the MD's leaderboard once computed.

### Frontend surface
- **Employee (ESS):** "My Performance" tab on the Employee Dashboard, backed by the `MyPerformancePanel` component.
- **HR / MD:** The "Star Performance" page (route `/star-performance`, `StarPerformance.jsx`), reachable from the HR top-nav and the admin sidebar.

### Related endpoints
- `GET /performance/bands` — HR-tunable increment band table (legacy MD review — surfaced for UI legend).
- `GET /performance/summary` — Org-wide leaderboard for the older MD review (task + attendance scoring, trailing 30 days by default).
- `GET /performance/employee/{employee_id}` — Per-employee drill-down of the legacy MD review score with per-task breakdown.
- `POST /performance/stars/compute` — Compute or refresh star scores for every active non-admin employee for a given `(VENDOR_ID, YEAR, MONTH)`. Idempotent.
- `GET /performance/stars` — List star scores for a period (defaults to the latest computed month), ranked by OVERALL_STARS descending.
- `GET /performance/stars/top?limit=N` — Top N performers for the latest computed period (dashboard tile).
- `GET /performance/stars/employee/{employee_id}/history` — All historical monthly star scores for one employee (trend graph).
- `PATCH /performance/stars/{score_id}/action` — MD records promotion/increment/rewarded flags and free-text remarks against one monthly score.

### Related database tables
- `PerformanceScore`
- `Employee`
- `Attendance`
- `TaskAssignment`
- `LeaveRequest`
- `Role`
- `Vendor`
- `Department`
- `PayrollSlip` (consumes PERFORMANCE_STARS and STAR_BONUS)
- `WorkOrderStageProgress`, `ProcessStage` (legacy productivity dimension, no longer scored)

### Frequently-asked-question hints
1. How is my star rating calculated?
2. Why did I only get 3 stars this month?
3. Does taking casual or sick leave lower my star rating?
4. How many permission hours can I take before losing a star?
5. How much extra do I earn per star on my payslip?
6. Are Sundays counted as working days for my attendance stars?
7. Do late check-ins hurt my attendance stars?
8. Does an incomplete or overdue task pull my task stars down?
9. Can my star score for last month change if I finish a task now?
10. Who decides if I get a promotion or increment based on my stars?

---

## Module: Onboarding

### What it does
Onboarding lets HR invite a new joiner with a single private link. When the new joiner opens the link, they log in with the Employee ID and password HR chose for them, fill in a registration form covering their personal, education, work, bank and KYC details, upload their photo and supporting documents, and hit Submit. Submitting turns the candidate into a live Employee record on the spot, and they are auto-logged into the employee portal.

### Who can use it
- Candidate (no login required beyond the link): opens `/employee-onboarding/{token}`, logs in with the Employee ID and password chosen by HR, fills the registration form, and submits.
- HR / Admin (permission-gated): `onboarding.invite` to create an invite, `onboarding.sessions.view` to browse invites, `onboarding.sessions.edit` to override values, `onboarding.sessions.approve` to approve a pending submission, `onboarding.sessions.reject` to reject, `onboarding.sessions.delete` to remove an invite, `onboarding.sessions.resend` to reissue an expired link.

### How it works
1. HR opens the Invite Employee dialog and enters the joiner's Name, Employee ID (EMPLOYEE_CODE), a starter password, an expiry in days (default 2), and optionally a Department and Designation.
2. The backend generates a URL-safe 32-byte token, creates an `EmployeeOnboardingSession` row with STATUS = `OPEN`, hashes the password with bcrypt, and returns an invite link of the form `<frontend base>/employee-onboarding/<token>`.
3. HR shares that link with the candidate (WhatsApp, email, in-person).
4. The candidate opens the link. The public state endpoint tells the UI whether the link is OPEN, SUBMITTED, APPROVED, REJECTED or EXPIRED.
5. The candidate logs in with their Employee ID and password. The password check is case-insensitive on the ID and uses bcrypt on the password.
6. The candidate fills the registration form (NAME, DOB, GENDER, MARITAL_STATUS, FATHER/MOTHER NAME, ADDRESS/CITY/STATE/PINCODE, PHONE, EMAIL, QUALIFICATION/YEAR_OF_PASSING/COLLEGE/UNIVERSITY/PERCENTAGE, EMPLOYMENT_TYPE/EXPERIENCE_YEARS/SKILLS/EXPERIENCE_DETAILS/PAST_PROJECTS/PREVIOUS_COMPANY/PREVIOUS_SALARY, BLOOD_GROUP/NATIONALITY, EMERGENCY_CONTACT_NAME/PHONE/RELATION, WORK_LOCATION, BANK_ACCOUNT_NUMBER/BANK_NAME/IFSC_CODE, PAN_NUMBER/AADHAAR_NUMBER, NOTES).
7. The candidate can also upload a photo and one or more supporting documents. Photos and documents are staged against the token until submit.
8. On Submit, the backend validates the payload, creates the Employee row using a default Role (EMPLOYEE / WORKER / first non-admin role available), copies the invite-time password hash onto the Employee, moves the staged documents into the employee's permanent folder, flips the session to STATUS = `APPROVED`, links the session to the new Employee, and returns an auto-login JWT so the candidate lands straight on the employee dashboard.
9. Legacy path: if a session gets stuck in `SUBMITTED` (older chat-based flow), HR uses the admin Approve endpoint to review and create the Employee row manually, or Reject with a reason.

### Business rules
- Password must be at least 6 characters at invite time.
- Employee ID (EMPLOYEE_CODE) must be unique. The invite is refused if the code is already used by an existing Employee, or by another OPEN or SUBMITTED onboarding invite.
- Expiry defaults to 2 days after invite creation; minimum 1 day. Resending a link accepts 1 to 90 days, default 7 days.
- Sessions have five statuses: `OPEN`, `SUBMITTED`, `APPROVED`, `REJECTED`, `EXPIRED`. `OPEN` sessions whose `EXPIRES_AT` has passed are automatically flipped to `EXPIRED` on the next access, and the public endpoint returns HTTP 410.
- Login rejects the request if the session is not `OPEN` (with friendly messages for SUBMITTED, APPROVED, REJECTED, EXPIRED).
- Photo uploads accept only `.png`, `.jpg`, `.jpeg`, `.webp`. Uploading a new photo deletes the previous one.
- Document uploads accept `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.txt`. Maximum file size is 10 MB per file. Photo and document upload are disabled unless the session is `OPEN` or `SUBMITTED`.
- Allowed document types are: RESUME, MARKSHEET, DEGREE_CERTIFICATE, AADHAAR, PAN, PASSPORT, DRIVING_LICENSE, OFFER_LETTER, EXPERIENCE_LETTER, PAYSLIP, BANK_STATEMENT, OTHER.
- Submit is refused if the session is not `OPEN`. The submitted EMPLOYEE_CODE must match the one on the invite (case-insensitive).
- Submit fails if the EMPLOYEE_CODE (uppercased) or EMAIL already belongs to another Employee.
- The password hash from invite time is copied straight to `Employee.PASSWORD` on approval, so the credentials HR chose keep working after the candidate joins.
- HR can override any candidate answer before approval; overrides are stored under `COLLECTED_DATA.__admin__` so the original answers remain visible.
- HR-only fields never asked from the candidate: ROLE_ID, SALARY, SHIFT_START, SHIFT_END, CONFIRMATION_DATE, and the final DEPARTMENT_ID / DESIGNATION_ID assignment.
- Approve is only allowed when STATUS is `SUBMITTED`; already `APPROVED` returns an error.
- Reject requires a non-empty reason (max 500 characters) and is refused on `APPROVED` sessions.
- Delete is refused while STATUS is `APPROVED` and the Employee row still exists. The linked Employee must be deleted first.
- Deleting a session also deletes its uploaded photo file.
- Resend generates a brand-new token (the old link is dead immediately), extends `EXPIRES_AT`, and reopens sessions that were `EXPIRED` or `REJECTED` back to `OPEN`.

### Approval workflow
The form-based flow auto-approves on Submit: the Employee row is created immediately and STATUS jumps from `OPEN` to `APPROVED`, with the candidate auto-logged in. HR can still review and edit the record afterwards from the Employees module. The legacy chat flow, and any session sitting at `SUBMITTED`, requires an HR user with the `onboarding.sessions.approve` permission to call the Approve endpoint; HR can also Reject with a reason. There is no multi-level or escalation path.

### Automation
Expiry is enforced on access rather than by a cron job: the first time a token is looked up after `EXPIRES_AT` has passed, the session is flipped to `EXPIRED` and the caller gets HTTP 410. No scheduled reminders are sent.

### Notifications sent
The employee onboarding flow itself does not send email, WhatsApp or in-app notifications on invite, submit, approve or reject. The invite link is handed to HR to share manually. (Customer onboarding, a separate module in the same code area, does send an invite email and an MD alert on completion.)

### Frontend surface
- Candidate: the public onboarding portal page at `/employee-onboarding/{token}` in the frontend SPA.
- HR: the HR module's Onboarding page, which lists sessions, opens the Invite Employee modal, edits sessions, and offers Approve / Reject / Resend Link / Delete actions.

### Related endpoints
- `POST /employee-onboarding/invite` — HR creates an invite and receives the link.
- `GET /employee-onboarding/{token}` — public read of session state, current field, progress, photo URL.
- `POST /employee-onboarding/{token}/login` — candidate logs in with Employee ID + password.
- `POST /employee-onboarding/{token}/upload-photo` — candidate uploads profile photo.
- `POST /employee-onboarding/{token}/upload-document` — candidate uploads a supporting document.
- `GET /employee-onboarding/{token}/documents` — list staged documents.
- `DELETE /employee-onboarding/{token}/documents/{doc_id}` — remove a staged document.
- `POST /employee-onboarding/{token}/submit-form` — candidate submits the registration form, auto-creates the Employee, returns a JWT.
- `POST /employee-onboarding/{token}/submit` — legacy submit (only flips status to SUBMITTED).
- `POST /employee-onboarding/{token}/chat` — deprecated; always returns HTTP 410.
- `GET /employee-onboarding/sessions` — HR lists sessions with optional status filter and free-text search.
- `GET /employee-onboarding/sessions/{id}` — full detail with collected data, chat history, notes.
- `PATCH /employee-onboarding/sessions/{id}` — HR overrides fields, notes, org block.
- `POST /employee-onboarding/sessions/{id}/approve` — HR approves a submitted session and creates the Employee.
- `POST /employee-onboarding/sessions/{id}/reject` — HR rejects with a reason.
- `DELETE /employee-onboarding/sessions/{id}` — HR removes a session.
- `POST /employee-onboarding/sessions/{id}/resend-link` — HR issues a fresh token and extended expiry.

### Related database tables
- `employee_onboarding_session`
- `employee` (created on submit / approval)
- `employee_document` (created when staged documents are promoted)
- `department`, `designation`, `role` (referenced by the invite and the created Employee)

### Frequently-asked-question hints
- How do I invite a new employee to onboard themselves?
- What details do I need to fill in when I get an onboarding link?
- My onboarding link says expired — what do I do?
- Can I change the Employee ID I gave the candidate?
- What password does the candidate use to log in the first time?
- Which documents can I upload during onboarding, and how big can they be?
- Do I need HR to approve me after I submit the form?
- Can HR edit my answers before approving my profile?
- What happens if my email or Employee ID is already used by someone else?
- How long is the onboarding link valid, and can HR resend it?
- Can I upload a photo, and which formats are allowed?
- Why can't I delete an approved onboarding record?

---

## Module: Org Chart

### What it does
The Org Chart shows the company's reporting hierarchy as a nested tree — who reports to whom, top-down. Every active employee in your vendor appears as a card with name, designation, department and photo, connected to their manager and their direct reports. Your own card is highlighted so you can spot yourself in the tree at a glance.

### Who can use it
Any signed-in employee can open the Org Chart from their ESS dashboard. There is no separate HR-only view — the same endpoint serves everyone. Visibility is limited automatically to your own vendor (company), so employees never see other vendors' hierarchies. There is no permission code gate beyond a valid login.

### How it works
1. The employee opens the Org Chart panel on their ESS dashboard.
2. The frontend calls `GET /org/chart` with the logged-in user's JWT.
3. The backend reads `vendor_id` and `employee_id` from the token.
4. It pulls every employee in that vendor whose status is `ACTIVE`, sorted by name.
5. It batch-loads the department and designation names for those employees in two lookup queries (avoiding per-row joins).
6. It indexes employees by their `REPORTING_MANAGER_ID` so each manager can find their direct reports instantly.
7. Anyone whose manager is missing, blank, or points to an inactive/non-existent employee is treated as a root of the tree.
8. The tree is built recursively from the roots down and returned as nested JSON, along with the current user's employee id (so the UI can mark "me") and the total employee count.

### Business rules
- Only employees whose `STATUS` is `ACTIVE` appear in the chart. Resigned, terminated, or inactive employees are excluded entirely.
- The chart is strictly vendor-scoped: only employees whose `VENDOR_ID` matches the caller's vendor are included. If the JWT has no `vendor_id`, it defaults to `1`.
- Parent–child relationships are read from the `REPORTING_MANAGER_ID` column on the employee record.
- An employee is treated as a root (top of a tree) when either:
  - Their `REPORTING_MANAGER_ID` is null, or
  - Their `REPORTING_MANAGER_ID` points to someone who is not in the active-employees set for this vendor (e.g. the manager left, was deactivated, or belongs to a different vendor).
- Because orphans become extra roots, the response can legitimately contain more than one root. `root_count` in the response reflects this.
- Employees are listed in ascending order by `NAME` within each level of the tree.
- Each node exposes: employee id, employee code, name (dash if blank), designation name, department name, photo URL, an `is_me` flag, and its children.
- The photo URL is returned exactly as stored on the employee record. Relative `/static/…` paths are passed through unchanged; the frontend prepends the API base URL when rendering.
- Department and designation names are resolved from the `Department` and `Designation` tables. If a department row exposes `DEPARTMENT_NAME` it is used, otherwise `NAME`; the same fallback applies to designations.
- The `is_me` flag is true only for the node whose id equals the caller's `employee_id` from the JWT.
- The response also includes `total_employees` — the count of active employees in the vendor that were fed into the tree.

### Approval workflow
None. The Org Chart is a read-only view of existing reporting relationships. Changes to who reports to whom happen elsewhere (employee record edits by HR/admin) and are reflected here on the next fetch.

### Automation
None. There is no cron job, scheduled refresh, or auto-trigger tied to the Org Chart. It is computed on demand each time the endpoint is called.

### Notifications sent
None. Opening or viewing the Org Chart does not fire any notification, email, or WhatsApp message.

### Frontend surface
- ESS: the Org Chart panel on the Employee Dashboard, rendered by `MyOrgChartPanel` (also linked from the Employee Profile page).
- HR/admin: no dedicated admin page — HR sees the same vendor-scoped tree via the same panel when logged in.

### Related endpoints
- `GET /org/chart` — returns the whole vendor's reporting tree as a nested JSON structure with `root_count`, `roots`, `me`, and `total_employees`.

### Related database tables
- `employee`
- `department`
- `designation`

### Frequently-asked-question hints
- Where can I see the company org chart?
- Who is my reporting manager?
- Who are the people reporting to me?
- Why does the org chart have more than one person at the top?
- Why isn't my colleague showing up in the org chart?
- Can I see other companies' org charts on this ERP?
- Why does my card look different in the org chart?
- How do I change who I report to?
- Are resigned employees shown in the org chart?
- What information does each employee card in the org chart show?

---

## Module: Roles Permissions

### What it does
Roles and permissions decide which screens and buttons each person can use inside the HRMS. Every employee is assigned one role (for example HR Manager or Sales Manager), and that role carries a list of permission codes that unlock specific actions such as approving leave, creating employees, or managing announcements. The two top-level roles, Admin and Super Admin, automatically get every permission without needing individual grants.

### Who can use it
- Every logged-in employee has a role — either the default `EMPLOYEE` role for self-service, or one of the manager-level roles for admin work.
- Employee-facing roles (allowed to sign in through the self-service portal): `EMPLOYEE`, `QC`, `MANAGER`, `PRODUCTION_HEAD`, `HR`, `ADMIN`, `SUPER_ADMIN`, `MANAGING_DIRECTOR`, `HR_MANAGER`, `SALES_MANAGER`, `PURCHASE_MANAGER`, `PRODUCTION_MANAGER`, `INVENTORY_MANAGER`, `ACCOUNTS_MANAGER`.
- Admin-facing roles (allowed into admin routes): `ADMIN`, `SUPER_ADMIN`, `HR`, `MANAGER`, `PRODUCTION_HEAD`, `MANAGING_DIRECTOR`, `HR_MANAGER`, `SALES_MANAGER`, `PURCHASE_MANAGER`, `PRODUCTION_MANAGER`, `INVENTORY_MANAGER`, `ACCOUNTS_MANAGER`. Plain `EMPLOYEE` is deliberately excluded from admin routes.
- Only holders of the `role.manage` permission (or Admin / Super Admin) can view or edit the permission catalogue itself.

### How it works
1. When an employee logs in, the system looks up their role and the permission codes attached to that role.
2. A JWT (access token) is issued containing `employee_id`, `code`, `name`, `role`, `permissions` (the list of codes), `department_id`, and `vendor_id`. The token is valid for 24 hours by default.
3. Every protected API request carries this token. The server decodes it and checks:
   - "Is the token valid and not expired?" — otherwise a 401 is returned.
   - "Does this route need a specific permission?" — if yes, the token must either come from `ADMIN` / `SUPER_ADMIN` (automatic pass) or contain at least one of the required permission codes.
4. Self-service endpoints additionally check that the employee ID or employee code in the URL matches the caller's own — an admin role bypasses this ownership check.
5. When an admin grants or revokes a permission on a role, existing members of that role must log out and log back in to receive an updated token; the new permissions only take effect after re-login.

### Business rules
- The `ADMIN` and `SUPER_ADMIN` roles bypass every permission check — they implicitly hold every code.
- All other roles (HR_MANAGER, SALES_MANAGER, PURCHASE_MANAGER, PRODUCTION_MANAGER, INVENTORY_MANAGER, ACCOUNTS_MANAGER, MANAGING_DIRECTOR, HR, MANAGER, PRODUCTION_HEAD, QC, EMPLOYEE) only get what has been explicitly granted through the role-to-permission mapping.
- A route protected by `require("code_a", "code_b")` allows anyone whose token contains either code_a or code_b (OR logic).
- Self-service endpoints allow either the owner of the record or any admin-level role — matching is done on both the employee UUID and the EMPLOYEE_CODE, case-insensitive on the code.
- If the JWT has no `employee_id`, the request is rejected with 403 "Authentication required — log in again".
- If the token is missing, malformed, or expired, the request is rejected with 401 "Invalid or expired token".
- If the role is not in the admin whitelist, admin routes return 403 "Admin access required".
- If a required permission code is missing, the response is 403 with the message "Missing required permission: <codes>".
- JWT tokens expire 24 hours after issue.
- Replacing role grants is an all-or-nothing operation: any unknown permission code aborts the update with 400.
- Grant and revoke operations for a single code are idempotent — repeating them does nothing extra.
- New employees created without a role default to the string `EMPLOYEE` in the token and hold zero permissions until a role with grants is assigned.

### Approval workflow
None. Permission changes take effect immediately when saved, but affected users only see them after their next login (their existing token is not rewritten).

### Automation
None. Roles and permissions are changed manually by an admin through the RBAC screens. Tokens simply expire after 24 hours and are re-issued at the next login.

### Notifications sent
None from this module. Permission changes are silent; the RBAC API response reminds the caller that "Members must re-login to pick up the new permissions in their JWT."

### Frontend surface
- Admin: the RBAC / Roles & Permissions admin page — lists roles with member and permission counts, opens a role detail view, and lets an admin grant or revoke codes.
- ESS: no direct tab. The employee only sees the effects — buttons and menu items that require a permission they do not hold are hidden or return an "access denied" message when used.

### Related endpoints
- `GET /rbac/roles` — List all roles with member and permission counts.
- `GET /rbac/roles/{role_id}` — One role's details plus the list of granted permission codes.
- `GET /rbac/permissions` — Full permission catalogue, grouped by category by default (`grouped=false` returns a flat list).
- `PATCH /rbac/roles/{role_id}/permissions` — Replace the role's grants with an exact set of codes.
- `POST /rbac/roles/{role_id}/permissions/grant` — Add one permission code to a role.
- `POST /rbac/roles/{role_id}/permissions/revoke` — Remove one permission code from a role.

### Related database tables
- `Role`
- `Permission`
- `RolePermission`
- `Employee` (holds `ROLE_ID`)

### Frequently-asked-question hints
- "Why can't I see the Approvals page — I'm a manager?"
- "How do I give the HR Manager the ability to approve leave?"
- "Why does my new permission not work until I log in again?"
- "What's the difference between Admin and Super Admin?"
- "Which roles can log in to the admin portal?"
- "Why am I getting a 'Missing required permission' error?"
- "My session expired — how long does a login last?"
- "Can a normal employee open someone else's leave history?"
- "How do I revoke a permission from a role?"
- "Why does the system say 'Admin access required' when I try to open Employees?"
