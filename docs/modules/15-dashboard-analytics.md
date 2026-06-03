# Module 15 — Dashboard & Analytics

## 15.1 Purpose

The Dashboard is the **first screen every admin sees** after login. It is the executive cockpit: a single page that surfaces the state of the entire business — employees, projects, tasks, inventory, attendance, sales, production — with live refresh and voice alerts on critical events.

## 15.2 Screens

- **DashboardHome** (`/`) — the main admin landing screen.
- **MDReview** (`/md-review`) — MD-specific deeper KPIs (revenue trend, top performers, lead pipeline).
- **Reports** (`/reports`) — configurable report builder (PDF / XLSX export).
- **StarPerformance** (`/star-performance`) — performance leaderboard.

## 15.3 DashboardHome Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Welcome card  ·  Voice toggle  ·  Date/time live clock         │
├─────────────────────────────────────────────────────────────────┤
│  Stat cards (4-grid)                                            │
│  [Employees]  [Projects]  [Tasks]  [Inventory]                  │
├─────────────────────────────────────────────────────────────────┤
│  Charts row                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐     │
│  │ Donut chart │  │ Bar chart   │  │ InventorySummaryCard │     │
│  │ (status mix)│  │ (per day)   │  │ (top low-stock items)│     │
│  └─────────────┘  └─────────────┘  └──────────────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│  Pending acceptance · Today's allocations · Recent activity     │
└─────────────────────────────────────────────────────────────────┘
```

## 15.4 Real-Time Refresh

- **Stat cards & charts** refresh every **10 seconds** (`setInterval` in `DashboardHome.jsx`).
- **Voice alerts** speak critical alerts as they appear (out-of-stock, failed QC, etc.).
- **Attendance live board** (`/attendance/live-board`) refreshes every **5 seconds** when open.

No WebSockets are used — polling is fine at the current scale and avoids the complexity of socket lifecycle management.

## 15.5 KPI Definitions

### Employees

- **Total employees**, **Active**, **On Leave today**, **New this month**

### Projects

- **Active projects**, **Pending**, **Completed this month**, **On hold**

### Tasks

- **Today's tasks** (count, completion %), **Overdue tasks**, **Tasks awaiting acceptance**

### Inventory

- **Total materials**, **Total stock value (₹)**, **Low stock count**, **Out of stock count**

### Sales (MDReview)

- **MTD Quotations sent**, **MTD Quotations approved**, **MTD SOs confirmed**, **MTD Revenue (sum of GRAND_TOTAL of CONFIRMED+ SOs)**, **Cash received (sum of milestone receipts)**

### Production

- **Active Work Orders**, **Stages completed today**, **Stages pending**, **NCRs open**

## 15.6 Charts

Implemented with **Recharts**:

| Chart | Data |
|---|---|
| **Donut — Project status mix** | Count by status across all projects (PENDING / IN_PROGRESS / COMPLETED / ON_HOLD) |
| **Donut — Task status mix** | Count by task status |
| **Bar — Daily task completion** | Last 7 days completed task count |
| **Bar — Weekly attendance** | Day-by-day Present/Late/Absent counts |
| **Inventory Summary Card** | Top 20 items with stock fill bar |

## 15.7 InventorySummaryCard

- Renders the 20 lowest-stock items.
- Each row: material name, category emoji, stock bar (filled = % of reorder level), quantity, value (₹).
- Filter chips: All / Low Stock / Out of Stock / By Category.
- Clicking a row deep-links to the Inventory page for that material.

## 15.8 Analytics API

`GET /analytics/dashboard-stats` — single endpoint returning all KPI aggregates in one round trip (server-aggregated to minimise the number of frontend queries).

```json
{
  "EMPLOYEES": { "TOTAL": 47, "ACTIVE": 45, "ON_LEAVE_TODAY": 3 },
  "PROJECTS": { "ACTIVE": 12, "PENDING": 5, "COMPLETED_MTD": 8, "ON_HOLD": 1 },
  "TASKS": { "TODAY": 35, "COMPLETED_TODAY": 22, "OVERDUE": 4, "AWAITING_ACCEPTANCE": 2 },
  "INVENTORY": { "TOTAL_MATERIALS": 142, "TOTAL_VALUE": 875000, "LOW_STOCK": 8, "OUT_OF_STOCK": 2 },
  "SALES": { "MTD_QUOTATIONS_SENT": 23, "MTD_SO_VALUE": 4500000, "MTD_CASH_RECEIVED": 2100000 },
  "PRODUCTION": { "ACTIVE_WO": 6, "STAGES_DONE_TODAY": 12, "STAGES_PENDING": 78, "NCR_OPEN": 1 }
}
```

`GET /analytics/chart-data?range=7d|30d|month` — time-series data for the bar charts.

## 15.9 Reports

`GET /reports/report/{module}.pdf` and `.xlsx` — generates a downloadable report.

Available modules:

- `sales` — quotations + sales orders, MTD or custom date range
- `production` — work order summary
- `inventory` — current stock snapshot
- `attendance` — month report
- `payroll` — month report (gated to HR / SUPER_ADMIN)
- `performance` — STAR ratings
- `quality` — inspection summary + NCRs

PDFs use a print-styled HTML template rendered server-side; XLSX uses `openpyxl` for native Excel files.

## 15.10 Settings

`GET /settings` and `PUT /settings/email-alerts` configure:

- Email alert toggles (per event)
- Default sender details
- Voice alert thresholds (which severities to speak)
- Working hours / shifts (used for attendance LATE calculations)

`POST /settings/test-email` is the manual smoke test for email config.

## 15.11 Data Sources Summary

The dashboard does not maintain a separate cache layer — every refresh hits the database. The aggregation queries use:

- `COUNT(*)` with `WHERE STATUS = ...` for status mixes.
- `SUM(QUANTITY × UNIT_PRICE)` for inventory value.
- `SUM(GRAND_TOTAL)` for MTD sales.
- `JOIN` employee → attendance → leave_request for today's attendance picture.

For 50+ tables and a single-vendor scale, this is fast enough (< 200 ms aggregated query time). When the user count grows, a materialised summary table refreshed every minute will be added.

---

Next: [Module 16 — Print & Public Links](./16-print-and-public-links.md)
