# BVC24 ERP — Connectivity Summary

The complaint was fair: every module was built, but they looked
like silos. You couldn't see how the parts fit together, why this
project matters, or what the outcome will be.

This iteration wires them all together — visually, in the data
layer, and in the UI. Here's what changed, why it matters, and
how to demo it.

---

## 🎯 The BVC24 story (in one paragraph)

> A customer places an order → it becomes a Project → the Project
> spawns Work Orders for the right Machine Model → the BOM tells us
> which parts to buy from which Supplier → ten manufacturing Stages
> are spawned per WO → at 10 AM every Employee scans their finger
> at the Gate, the AI picks the next pending Stage matching their
> Skills, prints a Task Sheet, and announces it by voice → the
> Employee marks each Stage ✓ or ✗ during the day → QC inspects
> before dispatch, any FAIL auto-opens an NCR → at 6 PM Check-Out
> stamps worked-hours → at month-end MD opens Performance Review
> and sees every employee's score + suggested increment %, with
> Leave Management auto-approving up to 2/month and escalating the
> 3rd to MD by email. **Every step is connected.**

That's why this project exists: **AI doing the daily allocation,
attendance, quality gating, and performance scoring — so the MD
doesn't have to manually track any of it.**

---

## 🆕 What was built in this iteration

### 1. Backend `/connect/*` route — 360° endpoints

Single HTTP call returns *everything* related to one entity:

| Endpoint | Returns |
|---|---|
| `GET /connect/employee/{id}/360` | profile + skills + today's attendance + active tasks + leave balance + recent biometric scans + assigned manufacturing stages + performance score |
| `GET /connect/project/{id}/360` | project + customer + all work orders + tasks + assigned employees + task stats |
| `GET /connect/work-order/{id}/360` | WO + model + project + BOM (rolled-up × qty) + stage progress (with assignees) + inspections + NCRs |
| `GET /connect/supplier/{id}/360` | supplier + KYC + which machine models depend on them + active WOs needing parts |
| `GET /connect/workflow/snapshot` | live counts at every node of the BVC24 flow — for the visual map |

These join across the previously-isolated tables and present the
connections explicitly.

### 2. Reusable `EntityDrawer.jsx` component

One side-drawer that opens for *any* entity type. Click an
employee, supplier, work order, or project name — the same drawer
shows the full picture.

Key feature: **drill-in navigation**. Inside the employee drawer,
clicking a project name re-opens the drawer in project mode, with
a "← back" button to return. You can drill: employee → project →
work order → supplier → another model → another employee, etc.,
without leaving the original page.

### 3. New "Workflow Map" sidebar page

A visual end-to-end diagram with 15 nodes (one per module) and
20 connecting arrows showing how data flows in real time:

```
Customers ─ orders ─→ Projects ─ spawn ─→ Work Orders
                                       ↑
            Suppliers ── parts ────────┘
                                       ↓
Employees ─ scan ─→ Biometric Gate ─→ Attendance + AI Tasks
              ↓                            ↓
              └────────────────────→ Process Stages
                                          ↓
                                     Quality + NCRs
                                          ↓
                                     Performance + Leave
```

Each node shows a **live count** from the snapshot endpoint and
**click-to-navigate** to the corresponding module.

A "Story Block" at the top of the page translates the snapshot
into 4 plain-English narrative cards:

- 👆 Gate-driven workforce — X scans today, Y in office
- 🏭 Production live — Z units across N WOs, K stages done today
- ✅ Quality gating — M inspections, P open NCRs (WO can't DONE without PASS)
- 📈 MD oversight — Q leave pending, R tasks completed feeding next month's increments

### 4. Cross-links wired into existing pages

Click these now and the 360° drawer opens:

| Page | Click target | Opens |
|---|---|---|
| **Employees** | Employee code OR name | Employee 360° |
| **Production → Work Orders** | WO number | Work Order 360° |
| **Suppliers** | Supplier code | Supplier 360° |
| **Workflow Map** | Any node | Module page |

Inside the drawer you can keep drilling — employee → their WO →
that WO's supplier → that supplier's other models.

---

## 🧭 How a user navigates now

**Before**: open Employees, see a table of names. Want to see
their tasks? Open Tasks page. Want their leave? Open Leave page.
Want their performance? Open MD Review. Four navigations to
answer one human question.

**After**: open Employees → click name → drawer shows tasks,
attendance, leave balance, performance, current production stage,
recent biometric scans, all in one view. Sub-links navigate to
the full module if needed.

Same pattern works for Suppliers (see all models + WOs depending
on them in one click) and Work Orders (see model + BOM + stages
+ inspections + NCRs in one drawer).

---

## 📐 The architecture in one diagram

```
┌────────────────────────────────────────────────────────┐
│                Backend SQLAlchemy tables               │
│                                                         │
│  employee  attendance  task_assignment  biometric_event│
│  project   customer    work_order       process_stage  │
│  supplier  product_model  bom_item   wo_stage_progress │
│  qc_inspection  ncr   leave_request   leave_balance    │
│  daily_allocation                                       │
└────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Per-module  │  │   /connect/  │  │ /connect/    │
│  routes      │  │   360°       │  │ workflow/    │
│  (existing)  │  │   endpoints  │  │ snapshot     │
└──────────────┘  └──────────────┘  └──────────────┘
        │                 │                 │
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Module pages │  │EntityDrawer  │  │ Workflow page│
│ (15 sidebars)│  │ (reusable)   │  │ (visual map) │
└──────────────┘  └──────────────┘  └──────────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
                   User sees connections
```

---

## 🗺️ Final sidebar structure (with the new entry)

```
📊 Dashboard
🔗 Workflow Map               ← NEW: visual end-to-end map
🏢 Organization
👥 Employees                  ← clicking a row opens 360°
🤝 Customers
📁 Projects
📦 Inventory
🕒 Attendance
🤖 Machines
🏭 Production & BOM           ← WO number opens 360°
✅ Quality Management
🚚 Suppliers                  ← supplier code opens 360°
🛒 Purchase
🌴 Leave Management
📈 MD Performance Review
📑 Reports
⚙️  Settings
```

Plus public routes:
- `/biometric` — gate kiosk (with attendance board)
- `/apply-leave` — employee leave portal

---

## 🎬 Demo flow that proves connectivity

1. **Workflow Map** (sidebar) → see all 15 nodes with live counts.
   Tell MD: *"Sir, every module is connected. This is the data
   flow."* Click any node — it lands on that module's page.

2. **Employees** → click *Ravi Kumar* → drawer opens with:
   - Today's check-in time
   - 1 active task
   - Currently working on Stage 4: Sheet Metal Fabrication of WO-2026-0001
   - Performance score 88 (band: Strong, suggested 8% raise)
   - Leave balance: Casual 11/12, Sick 12/12, Earned 15/15
   - Last 5 biometric scans

3. **Inside the drawer**, click *WO-2026-0001* → drawer switches
   to Work Order 360° with: model, BOM rolled up × 12 units, all
   10 stages with assignees, inspections, NCRs.

4. **Inside the WO drawer**, click *Bangalore Motors* (supplier of
   the spiral motor) → drawer switches to Supplier 360° with:
   GST, bank, payment terms, the other 4 models that use them,
   3 active WOs depending on them.

5. **Click ← back, back, back** → return to Ravi's drawer.

6. Tell MD: *"Sir, that whole chain — employee → task → WO → BOM
   → supplier — is one click each. No SQL, no spreadsheet, no
   manual cross-referencing."*

That's the value pitch in 90 seconds.

---

## 🔧 Files added / modified

### Backend (3 files)
- **NEW**: [connect.py](../backend/app/routes/connect.py) — 5 endpoints (~580 lines)
- **EDIT**: [main.py](../backend/app/main.py) — wire `connect_router`

### Frontend (5 files)
- **NEW**: [EntityDrawer.jsx](../frontend/src/components/EntityDrawer.jsx) — reusable 360° drawer
- **NEW**: [Workflow.jsx](../frontend/src/pages/Workflow.jsx) — visual map page
- **EDIT**: [Dashboard.jsx](../frontend/src/pages/Dashboard.jsx) — sidebar `🔗 Workflow Map` link + route
- **EDIT**: [Employees.jsx](../frontend/src/pages/Employees.jsx) — clickable employee code + name → drawer
- **EDIT**: [Production.jsx](../frontend/src/pages/Production.jsx) — clickable WO number → drawer
- **EDIT**: [Suppliers.jsx](../frontend/src/pages/Suppliers.jsx) — clickable supplier code → drawer

### Docs (1 file)
- **NEW**: this document ([CONNECTIVITY_SUMMARY.md](CONNECTIVITY_SUMMARY.md))

---

## 🌱 Next iteration suggestions (if connectivity is still felt missing somewhere)

The pages that still don't trigger the drawer (so still feel
isolated):

- **Projects page** — click project name → open Project 360°
- **MD Performance Review** — click employee row → open Employee 360°
- **Quality Management** — click WO# in inspection row → open WO 360°
- **Customers** — extend Project 360° with full customer profile
- **Attendance** — already shows Floor Board with current tasks;
  add a click-target for employee name → 360°

These are 5-line changes each — the EntityDrawer component is ready,
just need to wire the click handlers. Tell me which to wire next.

---

## 🧪 Quick verification

After backend restart + frontend hot-reload:

1. Open http://localhost:5173/workflow → 15 nodes appear with live numbers + arrows
2. Open http://localhost:5173/employees → employee codes are now blue underlined links
3. Click any employee code → side drawer opens with their full 360°
4. Inside the drawer, click a project name or WO number → drawer drills in
5. Hit "← back" → returns to the previous entity

Health check: `GET http://localhost:8001/connect/workflow/snapshot` — should return JSON with `people`, `products`, `sales`, `production`, `biometric`, `tasks`, `quality`, `leave`, `inventory` blocks.

---

## ✅ Bottom line

The complaint was that the project felt disconnected — and you
were right. Each module had its own purpose, but no one could see
how they fit together.

Now there's:
1. A **visual workflow map** that shows the connections at a glance
2. A **360° drawer** that shows every related piece of data from
   any clicked entity
3. **Backend endpoints** that pre-join the connections so the
   frontend doesn't have to chase multiple APIs
4. **Cross-links wired into the most-visited pages** so the user
   doesn't have to remember which module has what

**The "why" of this project is now visible.** It's not 15 silos —
it's one connected manufacturing nervous system. The MD demo can
now tell that story in 90 seconds with live data.
