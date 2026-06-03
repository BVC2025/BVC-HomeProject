# BVC24 AI Smart Manufacturing ERP — Live Demo Script

For the MD demo on **2026-05-23**. Total runtime: **~18 minutes**.
Follow the script in order — every step has a "what to click" + "what to say".

---

## 🟢 Pre-flight (5 minutes before MD walks in)

Open **3 browser tabs** in this order:

1. **Tab 1**: http://localhost:8001/docs (Swagger — backend health check)
2. **Tab 2**: http://localhost:5173/biometric (Gate kiosk — keep this large/full-screen)
3. **Tab 3**: http://localhost:5173/login (Admin dashboard)
4. **Tab 4**: http://localhost:5173/apply-leave (Employee leave page)

**Speaker volume ON** for voice alerts. **Allow popups** for the print receipt.

Run **seed once** in Tab 1: `POST /demo/seed-bvc24` → Execute. Confirm response shows ≥ 6 employees, 5 product models, 7 suppliers, ~50 process stages.

---

## 🎬 Demo flow

### Scene 1 — "10 AM. Ravi enters the factory." [2 min]

**Open**: Tab 2 (Biometric kiosk)

**Say to MD**:
> "Sir, this is the gate kiosk. Every morning at 10 AM, when an
> employee places their finger on the scanner, the system identifies
> them and assigns their work for the day — automatically."

**Click**:
1. Enter fingerprint ID **`1001`** → press **Scan**
2. Voice announcement plays: *"Welcome Ravi Kumar. You are assigned to Snack Combo Machine project..."*
3. Print dialog opens automatically with the task sheet

**Highlight to MD**:
- "Welcome card shows Ravi Kumar, BVC001"
- "AI matched his skills (assembly, wiring, sheet metal) to the Chennai Snack Combo project"
- "Score breakdown shown: skill match × 0.6 + workload × 0.25 + priority × 0.15"
- **Print receipt** has Start / Hold / Completed checkboxes — exactly as you described

---

### Scene 2 — "Priya, the software engineer, scans next." [1 min]

**Click**: Enter **`1002`** → Scan

**Highlight**:
- Different employee, **different project** — Medicine Dispenser Firmware
- AI picked it because Priya's skills are embedded C, IoT, RTOS, sensor integration
- "Same gate, same scanner — the AI does the matching."

---

### Scene 3 — "Ravi's personal dashboard." [2 min]

**Open**: Tab 3 → log in as employee (or open new tab `http://localhost:5173/login`)

**Say**:
> "Each employee has their own login and dashboard. They see only
> their own tasks."

**Show**:
- Today's tasks card
- Pending tasks card
- Task status: PENDING / IN_PROGRESS / DONE buttons

---

### Scene 4 — "MD got the approval email." [2 min]

**Open Gmail** (the configured APPROVER_EMAIL inbox)

**Say**:
> "When AI assigns a task or project, sir, you get an email
> immediately. You can approve or reject in one click — from your
> phone, anywhere."

**Highlight**:
- Subject: "Leave request — Ravi Kumar (CASUAL, ...)" or task approval
- Two big buttons: ✓ Approve / ✗ Reject
- Click the link → confirmation page in browser
- "No app to install. Email is the workflow."

---

### Scene 5 — "5 PM. Voice alert if task is incomplete." [1 min]

**Back to Tab 2 (Biometric kiosk)**

**Click**: The "🔊 Test 5 PM alert" button at the bottom

**Voice plays**:
> "Attention. Your task completion time is approaching. Please complete
> your task before the deadline at six PM. Otherwise a notification
> email will be sent to the MD."

**Say to MD**:
> "Sir, this fires automatically at 5 PM every day. Tomorrow when an
> employee hasn't finished, they hear this — and an email lands in
> your inbox."

---

### Scene 6 — "Leave Management." [2 min]

**Open**: Tab 4 (http://localhost:5173/apply-leave)

**Click**:
1. Pick "Karthik Raj" from the dropdown
2. Show the **3 balance tiles** (Casual 12, Sick 12, Earned 15)
3. Fill the apply form: Casual / today / today / "Family wedding"
4. Submit → shows "✓ Auto-approved (1/2 within monthly quota)"
5. Apply again with different dates → "Auto-approved (2/2)"
6. Apply a 3rd time → "⏳ Awaiting MD approval — email sent to MD"

**Say**:
> "Sir, BVC24 policy: first 2 leaves of the month auto-approve.
> The 3rd request automatically escalates to you by email — with
> the employee's reason. You decide. The system enforces the rule."

**Open Gmail** — show the leave approval email arrived.

---

### Scene 7 — "Production: machine catalog + BOM." [2 min]

**Open**: Admin dashboard → **Production & BOM**

**Click**:
1. Dashboard tab → "5 WOs, 16 units in progress"
2. Machine Models tab → click **Snack & Beverage Combo Machine**
3. Side drawer opens → show:
   - 10 BOM items with PURCHASE / PROCESS pills
   - Each PURCHASE line linked to a supplier (e.g., Bangalore Motors)
   - **Process Stages** section: Design → Mechanical → Electrical → Wiring → ... 10 stages

**Say**:
> "Sir, before AI assigns any task, the system already knows what
> needs to be built. Every machine has its BOM, every part has a
> supplier, every assembly step is mapped."

---

### Scene 8 — "Work Order Gantt timeline." [2 min]

**Same page** → Work Orders tab

**Click**: "📊 Timeline" button on any IN_PROGRESS WO

**Show**:
- 10 horizontal Gantt bars, one per stage
- Dashed = planned, solid colored = actual
- Click ▶ on Stage 1 → status moves to IN_PROGRESS (amber bar)
- Click ✓ → DONE (green bar)
- Click ✗ on Stage 2 → prompt for reason → enter "Sheet thickness wrong" → red FAILED bar

**Say**:
> "Sir, you see live production status. If any stage fails — like
> sheet thickness, wiring issue — it's marked here with the exact
> reason. You can pull this up anytime to see why a machine is delayed."

---

### Scene 9 — "Quality + NCR auto-creation." [1.5 min]

**Open**: Quality Management

**Click**:
1. Inspections tab → "+ Start Inspection" → pick a WO → submit
2. Click "Inspect" on new row → drawer opens with 10 checklist items
3. Mark 9 as PASS, 1 as FAIL → "Finalise Inspection"
4. Confirms → NCR auto-opens
5. Click NCRs tab → new NCR-2026-XXXX visible

**Say**:
> "Sir, pre-dispatch quality check. If anything fails, the system
> opens a Non-Conformance Report automatically with the responsible
> team and corrective action tracking. No paper, no missed defects."

---

### Scene 10 — "Supplier master + Purchase workflow." [1.5 min]

**Open**: Suppliers

**Show**: Table of 7 suppliers — Bangalore Motors, Chennai Electronics, etc.

**Click**: Edit one → show full GST, PAN, IFSC, payment terms.

**Open**: Purchase

**Click**:
1. Pick "BVC-SBC-01 Snack & Beverage Combo"
2. BOM lines load — purchase items separately, process items separately
3. Click "View details ▾" on a PURCHASE line → full supplier card with address, GST, bank

**Say**:
> "Sir, supplier master is just like the employee master. Complete
> GST, bank details, payment terms — all in one place. When we
> need to order parts, we pick the machine, see what to buy, and
> the supplier is already linked."

---

### Scene 11 — "MD Performance Review with auto-increment %." [1.5 min]

**Open**: MD Performance Review

**Click**:
1. Default range = last 30 days
2. Table shows 6 employees with **Score + Band + Suggested Increment %**
3. Click "View" on Ravi → drill-down with per-task breakdown

**Say**:
> "Sir, every month-end you don't need to manually figure out who
> deserves what increment. The system tracks every task, every
> on-time completion, every late delivery. It calculates a score
> from 0 to 100 and suggests an increment percentage:
> 90+ Outstanding 12%, 75+ Strong 8%, etc. You can override, but
> the data is right there."

---

### Scene 12 — "What else is built — quick tour." [1 min]

**Sidebar walkthrough**:
- **Organization** — departments + designations
- **Employees** — all 6 with skills + fingerprint IDs
- **Customers** — for sales side
- **Projects** — what we're building for whom
- **Inventory** — raw material stock
- **Attendance** — bio scan logs
- **Machines** — vending machines deployed
- All connected, one source of truth

---

### Scene 13 — "Test infrastructure + security." [30 sec]

**Open file**: `docs/UAT_CHECKLIST.md`

**Say**:
> "Sir, we built a Phase 6 testing layer too — 50 automated tests
> for every module, a printable UAT checklist for the ops team,
> a security audit document, and a known-issues list for the next
> sprint. This isn't a prototype. This is production-ready foundation."

---

## 📈 Closing pitch (30 sec)

> "Sir, what we have is **not a generic ERP**. It's a vending-machine-
> specific manufacturing brain:
>
> - **AI does the daily task allocation** — not a manager
> - **Biometric drives the floor** — not a punch-clock that just records time
> - **Voice + print + email** all wired in — not just screens
> - **MD has visibility** at every step — not just monthly reports
>
> What you saw is 18 modules built so far. Next sprint we tackle
> AI Forecasting (which parts to buy when), Sales Orders (close
> the order-to-cash loop), and Assembly stages per individual machine.
>
> Permission to proceed?"

---

## 🚨 Troubleshooting (just-in-case)

| Problem | Quick fix |
|---|---|
| "Allow popups" prompt blocks print | Click "Always allow popups from localhost" in URL bar |
| Voice doesn't play | Check system volume + Chrome → Site Settings → Sound: Allowed |
| Seed fails 500 | Run the ALTER queries from `docs/KNOWN_ISSUES.md` then retry |
| Backend not responding | Check terminal — restart: `python -m uvicorn app.main:app --reload --port 8001` |
| Email approval link 404 | Token may have been used. Apply a fresh leave from Tab 4 |
| Gantt timeline empty | The WO has no spawned stage rows yet. Re-run seed once |

---

## 🎤 If MD asks "What's missing?"

Be honest + frame as next iteration:

1. **AI Forecasting** — predict which parts to reorder based on past consumption
2. **Sales Orders + Invoicing** — close the order-to-cash loop
3. **Per-machine unit tracking** — Machine #1 at Stage 7, Machine #2 at Stage 5
4. **PLC integration** — direct connection to vending machine firmware
5. **Production deployment** (Docker + CI + HTTPS) — covered in `KNOWN_ISSUES.md`

> "Sir, all of these are designed and scoped. Each one is a 1-2 week
> module. We can demo any one next week."

---

## ✅ Demo-ready checklist (right before MD walks in)

- [ ] Backend running on http://localhost:8001 (Swagger loads)
- [ ] Frontend running on http://localhost:5173 (login page loads)
- [ ] `POST /demo/seed-bvc24` returned 200 with all counts > 0
- [ ] Tab 2 (biometric) speaker volume ON
- [ ] Tab 4 (apply-leave) — "Karthik Raj" pre-selected (cache it)
- [ ] Admin login credentials remembered
- [ ] APPROVER_EMAIL inbox open in a separate tab so the approval email is visible
- [ ] Phone or laptop charged
- [ ] One-page printout of `MEMORY` summary (this file's TOC) for MD to take away

**You're ready. Go close it.**
