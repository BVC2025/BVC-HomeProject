# BVC24 ERP — User Acceptance Test (UAT) Checklist

Phase 6 deliverable. Hand this document to the BVC24 ops team
(or anyone outside the dev team) and walk through it.

Every step has a verifiable **Expected Result**. Mark `[x]` once
the step passes, or write the actual outcome under "Found".

---

## Pre-flight — environment is up

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 0.1 | MySQL is running on `localhost:3306` | Connection succeeds via Workbench | [ ] |
| 0.2 | Backend started with `python -m uvicorn app.main:app --reload --port 8001` | Terminal shows `Application startup complete.` | [ ] |
| 0.3 | Open `http://localhost:8001/docs` | Swagger UI loads with title **"Bharath Vending ERP API"** | [ ] |
| 0.4 | Sections include: BVC24 Demo Seed, Biometric, Production & BOM, Quality Management, Suppliers, Process Stages, MD Performance | All 7 sections visible | [ ] |
| 0.5 | Frontend started with `npm run dev` | Terminal shows `Local: http://localhost:5173` | [ ] |
| 0.6 | Open `http://localhost:5173/login` | Login page renders, no console errors | [ ] |

---

## Section 1 — Seed BVC24 demo data

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 1.1 | Swagger → `POST /demo/seed-bvc24` → Execute | 200 response | [ ] |
| 1.2 | Response includes `product_models: 5`, `suppliers: 7`, `new_qc_checklist_items >= 40`, `new_process_stages >= 50` | Yes | [ ] |
| 1.3 | Response includes `demo_fingerprint_ids` with 6 IDs (1001 … 1006) | Yes | [ ] |
| 1.4 | Re-run the seed — second call should not duplicate any rows | Counts of "new_" fields drop to 0 or close | [ ] |

---

## Section 2 — Biometric gate kiosk

Open in a new browser tab: **`http://localhost:5173/biometric`**

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 2.1 | Page renders dark blue gradient + live clock + BVC24 branding | Yes | [ ] |
| 2.2 | Enter fingerprint **9999** → Scan | Red error: "No employee enrolled with fingerprint 9999" | [ ] |
| 2.3 | Enter fingerprint **1001** → Scan | Green "CHECKED IN" card, "Welcome, Ravi Kumar", BVC001, allocated project + task displayed | [ ] |
| 2.4 | AI reason text appears below the project ("skills matched: assembly, wiring, ...") | Yes | [ ] |
| 2.5 | Score breakdown visible ("score: 0.xx (skill=... workload=... priority=...)") | Yes | [ ] |
| 2.6 | Within 5 minutes, scan **1001** again | "Task in progress" status — no double allocation | [ ] |
| 2.7 | Scan **1002** | Welcome Priya Selvam, allocated to "Medicine Dispenser Firmware v2.3" (skills matched: embedded c, iot, rtos, sensor integration) | [ ] |
| 2.8 | Recent Scans rail on right updates with every scan | Yes | [ ] |
| 2.9 | All 6 employees (1001-1006) scan successfully and get different projects | Each gets a relevant project for their dept | [ ] |

---

## Section 3 — Admin Dashboard login

Open: **`http://localhost:5173/login`**

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 3.1 | Log in as admin (existing credentials) | Dashboard loads | [ ] |
| 3.2 | Sidebar shows: Dashboard, Organization, Employees, Customers, Projects, Inventory, Attendance, Machines, **Production & BOM**, **Quality Management**, **Suppliers**, **Purchase**, **MD Performance Review**, Reports, Settings | All 5 new links visible (Production, Quality, Suppliers, Purchase, MD Review) | [ ] |

---

## Section 4 — Production & BOM module

Click **Production & BOM** in the sidebar.

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 4.1 | Default tab "Dashboard" — 4 tiles + Top Active Models list | All tiles non-zero (5 WOs, ~16 units in progress) | [ ] |
| 4.2 | Click **Machine Models** tab — 5 cards | All 5 BVC machine models with code + category + build days | [ ] |
| 4.3 | Click "Snack & Beverage Combo Machine" card | Side drawer opens with model details, BOM table, **Process Stages** section | [ ] |
| 4.4 | BOM table has **Type** column showing PURCHASE (blue) / PROCESS (purple) pills | At least 5 PURCHASE + 1-2 PROCESS lines | [ ] |
| 4.5 | BOM **Source** column shows supplier name (for PURCHASE) or stage name (for PROCESS) | E.g. "Bangalore Motors & Drives" for spiral motor | [ ] |
| 4.6 | Process Stages section lists 10 stages: Design Review → Mechanical → Electrical → Wiring → Fabrication → Assembly → Software Flashing → Bench Testing → Pre-Dispatch QC → Packaging | All 10 with sequence numbers and estimated hours | [ ] |
| 4.7 | Click **Work Orders** tab — table with 5 seeded WOs | WO-2026-0001, ...0002, etc. | [ ] |
| 4.8 | Each WO row has **📊 Timeline** button + status advance button | Yes | [ ] |
| 4.9 | Filter by "IN_PROGRESS" → 2 WOs | Yes | [ ] |
| 4.10 | Click **+ Create WO** form: pick model, qty 5, note "UAT test batch" → Create WO | New WO appears at top with PLANNED status, fresh WO_NUMBER | [ ] |

---

## Section 5 — Gantt Timeline per WO

In Production → Work Orders, click **📊 Timeline** on any IN_PROGRESS row.

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 5.1 | Drawer opens with WO number + product name + 4 stat tiles | Progress %, Planned hours, Actual hours, Failed count | [ ] |
| 5.2 | Legend shows: Planned (dashed), Done (green), In Progress (amber), Failed (red) | Yes | [ ] |
| 5.3 | 10 rows — one per stage with sequence circle + name + type + hours | All visible | [ ] |
| 5.4 | Each row has a horizontal Gantt bar showing planned time | Dashed bar visible | [ ] |
| 5.5 | Click ▶ (start) on row 1 (Design Review) | Status → IN_PROGRESS (amber), bar appears solid | [ ] |
| 5.6 | Click ✓ (done) on row 1 | Status → DONE (green), bar turns green, completed_at recorded | [ ] |
| 5.7 | Click ✗ (fail) on row 2 (Mechanical Design) — prompt asks reason → enter "Sheet thickness wrong" | Status → FAILED (red), reason saved | [ ] |
| 5.8 | Progress tile updates: "1 / 10 done" | Yes | [ ] |
| 5.9 | Close drawer, reopen — state persists | Yes | [ ] |

---

## Section 6 — Quality Management module

Click **Quality Management** sidebar.

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 6.1 | Dashboard tab — 4 tiles (Pass Rate, Total Inspections, Open NCRs, Total NCRs) | All visible | [ ] |
| 6.2 | Pass Rate 100% (only seeded sample inspection passed) | Yes | [ ] |
| 6.3 | Click **Checklists** tab — left list of 5 machines | Yes | [ ] |
| 6.4 | Click "Snack & Beverage Combo Machine" → 10 inspection points with CRITICAL/MAJOR/MINOR pills | Yes | [ ] |
| 6.5 | Click **Inspections** tab → 1 row (sample seeded PASS inspection) | Yes | [ ] |
| 6.6 | "+ Start Inspection" → pick an IN_PROGRESS WO + inspector → submit | New PENDING inspection row appears | [ ] |
| 6.7 | Click "Inspect" on the new row | Drawer with all checklist items + PASS/FAIL/REWORK/NA buttons | [ ] |
| 6.8 | Mark all PASS except one FAIL with note "Test failure" | Counters update live | [ ] |
| 6.9 | Click "Finalise Inspection" — confirm dialog | Inspection status becomes FAIL, NCR auto-opened | [ ] |
| 6.10 | Click **NCRs** tab → at least 1 NCR with NCR_NUMBER (e.g. NCR-2026-0001) | Yes | [ ] |
| 6.11 | NCR → IN_PROGRESS → CLOSED button transitions work | Status changes | [ ] |

---

## Section 7 — QC Gate (Production × Quality integration)

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 7.1 | Production → Work Orders → pick IN_PROGRESS WO without a PASS inspection → click "→ DONE" | Error popup: "QC gate: cannot mark DONE without a finalised PASS inspection..." | [ ] |
| 7.2 | Go to Quality → finalise an all-PASS inspection for that WO | Inspection status: PASS | [ ] |
| 7.3 | Back to Production → same WO → click "→ DONE" | Status moves to DONE, ACTUAL_END_DATE stamped today | [ ] |

---

## Section 8 — Suppliers module

Click **Suppliers** sidebar.

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 8.1 | Table with 7 suppliers loaded | Yes | [ ] |
| 8.2 | Category filter dropdown has: Display, Electronics, Glass, Motors, Payment Hardware, Refrigeration, Sheet Metal | Yes | [ ] |
| 8.3 | Filter "Motors" → only Bangalore Motors row visible | Yes | [ ] |
| 8.4 | Search for "Coimbatore" → shows suppliers in Coimbatore | At least 2 results | [ ] |
| 8.5 | Click **+ New Supplier** → drawer with sections (Contact / Address / KYC / Banking) | All fields render | [ ] |
| 8.6 | Fill required fields, save | New supplier appears in the table | [ ] |
| 8.7 | Edit existing supplier → change Payment Terms to "NET 60" → save | Update reflected | [ ] |
| 8.8 | Deactivate a supplier → STATUS pill turns gray | Yes | [ ] |

---

## Section 9 — Purchase workflow

Click **Purchase** sidebar.

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 9.1 | Pick "BVC-SBC-01 — Snack & Beverage Combo Machine" from dropdown | BOM loads, 3 stat tiles populated | [ ] |
| 9.2 | Stat tiles show: Purchase Lines (≥5), In-house Process, Unassigned (low number) | Yes | [ ] |
| 9.3 | Purchase Items section lists BOM lines with supplier name on each | Yes | [ ] |
| 9.4 | Click "View details ▾" on a line with supplier | Supplier card expands showing: Contact, Address, KYC (GST/PAN/Payment), Bank | [ ] |
| 9.5 | If any unassigned line exists, dropdown to assign supplier appears inline | Pick one → saves immediately, reload shows supplier | [ ] |
| 9.6 | Switch to "BVC-MED-01" (Medicine Dispenser) | BOM updates, different supplier set visible | [ ] |
| 9.7 | In-house Process Items section lists items linked to fabrication stages | Yes | [ ] |

---

## Section 10 — MD Performance Review

Click **MD Performance Review** sidebar.

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 10.1 | Page loads with 4 summary tiles + date range picker | Yes | [ ] |
| 10.2 | Default range = last 30 days | Yes | [ ] |
| 10.3 | Employee table lists 6 BVC employees | Yes | [ ] |
| 10.4 | If no tasks completed → all scores 0, band "No data" | Yes | [ ] |
| 10.5 | Click "View" on any row | Drill-down modal opens with score breakdown + per-task table | [ ] |
| 10.6 | Drill-down shows: Score tile, Suggested Increment %, Tasks Completed, Avg Early | All visible | [ ] |
| 10.7 | After multiple biometric scans + task completions (Section 2), refresh — scores update | Yes | [ ] |

---

## Section 11 — Cross-module integrity

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 11.1 | After biometric scan creates a task, that task appears in MD Performance "View" drill-down once completed | Yes | [ ] |
| 11.2 | Closing the Quality NCR opened in Section 6 reflects in Quality Dashboard "Open NCRs" count | Yes | [ ] |
| 11.3 | Creating a Work Order auto-spawns 10 stage progress rows accessible via Timeline | Yes | [ ] |
| 11.4 | Editing a BOM item's PURCHASE/PROCESS classification updates the Purchase page view | Yes | [ ] |

---

## Section 12 — Edge cases + error handling

| # | Action | Expected Result | Pass |
|---|---|---|---|
| 12.1 | Try to create Work Order for non-existent ProductModel ID via Swagger | 404 returned | [ ] |
| 12.2 | Try to create Supplier with duplicate code | 409 Conflict returned | [ ] |
| 12.3 | Biometric scan an inactive (SUSPENDED) employee | 403 returned with message | [ ] |
| 12.4 | Submit incomplete inspection (PENDING items) → Finalise blocked at UI level | "Mark all pending items first" message | [ ] |

---

## Sign-off

| Role | Name | Date | Notes |
|---|---|---|---|
| Tester | _____________ | _____ | _____ |
| Module owner | _____________ | _____ | _____ |
| BVC24 ops sign-off | _____________ | _____ | _____ |
| Dev lead sign-off | _____________ | _____ | _____ |

---

**Total checkpoints: ~80**

If ≥ 90% pass → module is UAT-cleared for that section.
If < 90% pass → log findings in [KNOWN_ISSUES.md](KNOWN_ISSUES.md) and re-test after fixes.
