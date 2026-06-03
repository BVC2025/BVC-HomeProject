# BVC24 ERP — Known Issues & Optimization Backlog

Phase 6d deliverable. Captured during code walkthrough + UAT
dry runs + the security audit. Sorted by priority. Tick items
off as they're fixed.

---

## 🐞 Functional Bugs

### B-1. Performance route ignores `department_id` filter coming from UI ⚠️

[`backend/app/routes/performance.py`](../backend/app/routes/performance.py) accepts `department_id`
but the [MDReview.jsx](../frontend/src/pages/MDReview.jsx) page never
sends it. Filter is dead code on the frontend.

**Fix**: Add a department dropdown to MD Review page, pass `department_id` in query.

---

### B-2. WO Gantt cursor over-counts hours when stage is FAILED + retried

Backend `/process/wo/{id}/gantt` always advances the planned
cursor by `estimated_hours`, even for FAILED stages. If a stage
gets restarted, the planned timeline drifts.

**Fix**: Reset cursor to `now()` when a stage is FAILED + restarted, or recalculate cursor from the latest actual COMPLETED_AT.

---

### B-3. Re-running `/demo/seed-bvc24` doesn't reseed QC checklists

If a model already has any checklist items, the seed skips it
entirely. New items added to `BVC24_QC_CHECKLISTS` after the
first seed won't be picked up unless the table is manually cleared.

**Fix**: Diff existing rows vs the constant; insert new ones, leave others alone.

---

### B-4. Production page Models tab has no "Add Model" button

Backend has `POST /production/models`, but no UI form on the
Production page. Users have to use Swagger.

**Fix**: Add a + New Model button + drawer form, like Suppliers.

---

### B-5. BiometricCheckIn page silently swallows errors from `/biometric/events`

[`frontend/src/pages/BiometricCheckIn.jsx`](../frontend/src/pages/BiometricCheckIn.jsx) — the
`fetchRecent()` function has `catch (e) { /* recent feed is non-critical */ }`. If the API
is broken, the user sees an empty rail with no diagnostic info.

**Fix**: Log to console with prefix for grep-ability; consider toast on first failure.

---

### B-6. Date-range filter on MD Review loads `vendor_id=1` only

Same as the vendor resolver issue we fixed — if BVC24 vendor isn't
ID 1, the page still works (backend resolves), but URL/query stays
misleading. Cosmetic.

**Fix**: Frontend fetches the BVC24 vendor ID on mount via a
`/demo/bvc24-vendor-info` endpoint and uses it consistently.

---

### B-7. `BOMItem.delete` is a hard delete

Inconsistent with `Supplier.delete` (soft via STATUS). If a BOM
line is referenced by a Work Order that's mid-production, hard delete
breaks the BOM rollup.

**Fix**: Add `IS_ACTIVE` to BOMItem; soft-delete; filter list views by IS_ACTIVE=1.

---

## 🧪 Test Coverage Gaps

### T-1. No frontend tests

Backend pytest suite is in place (~40 tests). Frontend has zero
tests — neither Vitest nor React Testing Library.

**Plan**: Add Vitest + RTL, cover BiometricCheckIn flow (state machine UI), MDReview drill-down, Suppliers form validation.

---

### T-2. Pytest suite assumes seed always succeeds

Many integration tests start with `seeded_client` fixture. If
the seed itself breaks, ALL tests fail — masking individual
module regressions.

**Fix**: Add a `minimal_client` fixture that only seeds the bare minimum (vendor + 1 employee + 1 model). Use it where the full seed isn't needed.

---

### T-3. No load/perf tests

No `locust` or `httpx` benchmark. Don't know how many concurrent
biometric scans the allocator can handle.

**Plan**: 100 concurrent `/biometric/scan` requests, measure p50/p95 latency.

---

### T-4. No tests for failure paths

What happens if MySQL connection drops mid-request? What if
`bcrypt.gensalt()` is slow under load? Untested.

---

## ⚡ Performance Optimizations

### O-1. N+1 query in `/quality/inspections` list

The list endpoint joins WorkOrder + ProductModel + Employee per row.
Fine for <100 rows; will become slow with hundreds.

**Fix**: Add proper indexes on `qc_inspection.WORK_ORDER_ID`, `.INSPECTOR_ID`. Use `selectinload` for related entities. Limit default page size to 50.

---

### O-2. `/biometric/events?limit=N` has no pagination cursor

Returns the latest N rows but no way to "load more". Older events
become inaccessible from the UI.

**Fix**: Cursor-based pagination using `EVENT_TIME < last_seen_time`.

---

### O-3. `_classify_existing_bom` in seed iterates BOM × supplier keywords

O(BOM_lines × supplier_keywords) — fine for ~40 lines, but scales poorly.

**Fix**: Pre-compute a regex / trie for the keyword set. Not urgent.

---

### O-4. Frontend re-fetches all BOM lines on each Purchase page model change

`useEffect` triggers a new `/production/models/{id}/bom` call each
time. Should cache by model ID.

**Fix**: React Query (or local Map cache) keyed on model ID.

---

### O-5. Dashboard `/quality/dashboard` does 5 separate count queries

One per status. Should be one GROUP BY query.

**Fix**:
```python
status_counts = dict(
    db.query(QCInspection.STATUS, func.count(QCInspection.ID))
    .filter(QCInspection.VENDOR_ID == vendor_id)
    .group_by(QCInspection.STATUS)
    .all()
)
```

---

### O-6. `Base.metadata.create_all(bind=engine)` runs on every app start

Cheap when nothing changes, but should be moved to a one-shot Alembic
migration script for production. Schema changes shouldn't be
silently applied on app boot.

**Fix**: Adopt Alembic; remove `create_all` from `main.py`; run migrations as a deploy step.

---

## 🔧 Code Quality / Tech Debt

### Q-1. Auth not applied to new modules (also in SECURITY_AUDIT.md C-1)

Tracked separately — see [SECURITY_AUDIT.md](SECURITY_AUDIT.md#c-1).

---

### Q-2. Pydantic schemas have no field-level constraints

Most schemas use bare `str`, `int`, no `Field(...)` constraints.
Means invalid data (e.g., negative quantities, 1000-char GST numbers) reaches the DB.

**Fix**: See SECURITY_AUDIT H-3.

---

### Q-3. No centralised error response format

Different modules use different error patterns (`detail`, `message`, raw strings).

**Fix**: Standardise on FastAPI's `HTTPException(detail=...)` everywhere, return shape `{"detail": "<message>"}`.

---

### Q-4. `vendor_id` hardcoded as `1` in frontend

[`frontend/src/pages/Production.jsx`](../frontend/src/pages/Production.jsx) and others always send `vendor_id: 1`. Backend now resolves intelligently (via `_resolve_vendor_id`) but the frontend should learn its tenant from auth context.

**Fix**: On login, store BVC24 vendor ID alongside JWT; use it everywhere.

---

### Q-5. Magic numbers in allocation_service

`SCAN_DEBOUNCE_SECONDS = 300`, `WORKLOAD_CAP = 8`, `MIN_REMAINING_MINUTES_FOR_NEXT_TASK = 120` — should be in a `Setting` table so HR can tune without code deploy.

---

### Q-6. Multiple "_resolve_vendor_id" copies in different routes

[`production.py`](../backend/app/routes/production.py), [`performance.py`](../backend/app/routes/performance.py), [`supplier.py`](../backend/app/routes/supplier.py), [`quality.py`](../backend/app/routes/quality.py) each redefine it.

**Fix**: Move to `app/services/tenant.py` and import.

---

### Q-7. No OpenAPI tags consistency

Some routers use `tags=["Production & BOM"]`, others `tags=["Suppliers"]`, others none. Swagger UI grouping is inconsistent.

---

### Q-8. No `__repr__` on models — DB query debugging is painful

Add `def __repr__(self): return f"<{type(self).__name__} id={self.ID}>"` to Base.

---

## 📊 Manufacturing-domain Gaps

### M-1. Stages don't auto-advance Work Order status

Marking the last stage as DONE doesn't move the WO to DONE
automatically. Operator has to manually advance.

**Fix**: After stage update, check if all 10 stages are DONE → if so, prompt to move WO to DONE.

---

### M-2. BOM doesn't track unit cost / total cost

We deferred costing this iteration. Without it, no PO valuation, no margin calc.

**Plan**: Pull cost from Inventory.UNIT_PRICE × QUANTITY. Surface line cost + total BOM cost.

---

### M-3. Inventory consumption isn't deducted when WO progresses

When stages are marked DONE, raw materials should deduct from `inventory.QUANTITY`. Currently inventory is decoupled from production.

**Plan**: BOM × WO.QUANTITY = required materials. Deduct on WO IN_PROGRESS or per-stage.

---

### M-4. No multi-machine batch tracking

A WO for 12 machines is treated as one unit. Can't see "Machine #3 is at stage 7 while Machine #4 is at stage 5."

**Plan**: Add `unit_progress` table — per-machine progress under a WO. Complex but valuable for shop floor.

---

### M-5. No Purchase Order (PO) creation flow

Supplier master + classified BOM exist, but no `purchase_order` table or workflow to actually buy from a supplier.

**Plan**: Build PO model with line items linked to BOM + supplier. Generate from a WO's BOM.

---

## 📦 Deployment Backlog

### D-1. No production `Dockerfile` / `docker-compose.yml`

Currently runs on developer's Windows with venv + npm. No path to staging/production.

---

### D-2. No CI pipeline

No GitHub Actions or similar to run pytest on every push.

---

### D-3. No database backup strategy

MySQL runs locally without scheduled backups.

---

### D-4. No log aggregation

`print()` statements in `main.py` go to stdout. Production needs centralised logs (Loki, ELK, CloudWatch).

---

### D-5. Frontend not built for production

`npm run dev` only. Need `npm run build` + static file serve via nginx / Vite preview.

---

## Prioritisation matrix

| Priority | Items | Effort |
|---|---|---|
| **P0 — Block production** | B-7, T-1 (basic), all SECURITY_AUDIT C/H items | ~4-6 hours |
| **P1 — Block scaling** | O-1, O-5, O-6, D-1, D-2 | ~1-2 days |
| **P2 — UX completeness** | B-1, B-4, M-1, M-2, M-3, M-5 | ~3-5 days |
| **P3 — Polish** | Everything else | rolling |

---

## Suggested next-iteration scope (after Phase 6)

1. Fix all CRITICAL security findings (C-1, C-2, C-3, H-4)
2. Resolve B-7 (soft delete BOM items)
3. Add PO creation flow (M-5) — natural follow-on to Supplier master
4. Add Sales Orders (Phase 3 still partial)
5. Adopt Alembic + CI (O-6, D-2)
