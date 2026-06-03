# Module 11 — Quality Management

## 11.1 Purpose

The Quality module enforces a **mandatory inspection gate** between production completion and shipping. Every Work Order must pass an inspection before its status can advance to `DONE` — and any failed check automatically opens a Non-Conformance Report (NCR) that must be resolved before closure.

## 11.2 Screens

- **Quality** (`/quality`) — main quality screen with three sections:
  - **Inspection list** — all inspections with status (Pending / Pass / Fail / Rework).
  - **NCR list** — open and closed Non-Conformance Reports.
  - **Checklists editor** — per-product-model checklist templates.

## 11.3 Three Entities

### QCChecklistItem (template)

One inspection point per product model. Created once per model and reused across every WO of that model.

| Column | Notes |
|---|---|
| `PRODUCT_MODEL_ID` | which model this check applies to |
| `SEQUENCE`, `CHECK_POINT`, `DESCRIPTION` | what to inspect |
| `SEVERITY` | `CRITICAL` / `MAJOR` / `MINOR` |
| `IS_ACTIVE` | soft delete |

Example checklist for a Snack & Beverage Combo:

- Door alignment (MAJOR)
- Coil rotation test (CRITICAL)
- Refrigeration cooling test (CRITICAL)
- Touch screen responsiveness (MAJOR)
- UPI scanner connectivity (CRITICAL)
- LED display brightness (MINOR)
- Final paint inspection (MINOR)
- Power cable strain relief (MAJOR)
- Serial number engraving (MINOR)
- Packaging integrity (MAJOR)

### QCInspection (instance)

One inspection per Work Order. Created when production declares the WO ready for QC.

| Column | Notes |
|---|---|
| `WORK_ORDER_ID`, `PRODUCT_MODEL_ID` | FKs |
| `INSPECTOR_ID` | FK → `employee.ID` (typically a QC role) |
| `INSPECTION_DATE` | |
| `STATUS` | `PENDING` / `PASS` / `FAIL` / `REWORK` |
| `PASS_COUNT`, `FAIL_COUNT`, `REWORK_COUNT` | aggregates |

### QCInspectionResult

Per-checklist-item result for one inspection. Created for every checklist item when the inspection is created (so the inspector sees the full checklist).

| Column | Notes |
|---|---|
| `INSPECTION_ID`, `CHECKLIST_ITEM_ID` | composite identity |
| `CHECK_POINT` | snapshot |
| `RESULT` | `PASS` / `FAIL` / `NEEDS_REWORK` / `NA` |
| `NOTES` | inspector's free-text |
| `RECORDED_AT` | when set |

## 11.4 Workflow

```
1. POST /quality/inspections
   { WORK_ORDER_ID, INSPECTOR_ID }
   - Creates QCInspection (STATUS=PENDING)
   - For each active QCChecklistItem of the WO's product:
     create QCInspectionResult with RESULT=PENDING

2. PATCH /quality/results/{result_id}
   { RESULT: "PASS" | "FAIL" | "NEEDS_REWORK" | "NA", NOTES }
   - Updates the per-item result
   - Increments inspection's PASS_COUNT / FAIL_COUNT / REWORK_COUNT

3. (For each FAIL or NEEDS_REWORK)
   - Auto-create an NCR row:
     * NCR_NUMBER auto-generated
     * INSPECTION_ID, WORK_ORDER_ID, PRODUCT_MODEL_ID
     * CHECK_POINT snapshot, SEVERITY from checklist item
     * STATUS = OPEN
     * REPORTED_BY_ID = INSPECTOR_ID
   - NCR appears in the Quality module's NCR list

4. POST /quality/inspections/{inspection_id}/finalise
   - Validates all results are set (no PENDING remaining)
   - Computes STATUS:
       all PASS              → STATUS=PASS
       any FAIL              → STATUS=FAIL
       any NEEDS_REWORK only → STATUS=REWORK
   - If STATUS = FAIL or REWORK: blocks Work Order from advancing
     to DONE until NCRs are closed.

5. NCR resolution
   PATCH /quality/ncrs/{ncr_id}
   { STATUS: "IN_PROGRESS" | "CLOSED",
     ROOT_CAUSE, CORRECTIVE_ACTION,
     ASSIGNED_TO_ID }
   - CLOSED requires ROOT_CAUSE and CORRECTIVE_ACTION filled
   - CLOSED sets CLOSED_AT timestamp

6. Once all NCRs for the WO are CLOSED → Work Order can be advanced
   to DONE. A re-inspection may be created if the rework was substantial.
```

## 11.5 Severity Levels

Behaviour driven by `QCChecklistItem.SEVERITY`:

| Severity | Failure consequence |
|---|---|
| `CRITICAL` | Auto-NCR, blocks WO `DONE`, requires re-inspection after rework |
| `MAJOR` | Auto-NCR, blocks WO `DONE`, may allow same-cycle correction with sign-off |
| `MINOR` | Auto-NCR, does NOT block WO `DONE` — captured for trend analysis |

This severity policy is enforced at the inspection-finalise step.

## 11.6 NCR Lifecycle

```
OPEN ─assign─► IN_PROGRESS ─resolve─► CLOSED
                                       │
                                       └─ re-inspection (optional)
```

NCR columns capture the discipline:

- `DESCRIPTION` — what was wrong
- `ROOT_CAUSE` — why it happened (must be filled to close)
- `CORRECTIVE_ACTION` — what was done (must be filled to close)
- `REPORTED_BY_ID` — inspector who flagged
- `ASSIGNED_TO_ID` — production / QC employee responsible for fixing
- `OPENED_AT`, `CLOSED_AT` — for cycle-time metrics

## 11.7 Quality Dashboard

`GET /quality/dashboard` aggregates:

- Inspections this month (count by status)
- Pass-rate %
- Average inspection cycle time
- Open NCRs (count by severity)
- NCR closure time (median)
- Top failing check points (trend)
- Inspector productivity

## 11.8 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /quality/checklist-items` | Create check (per product model) |
| `GET /quality/checklist/{model_id}` | List checks for product |
| `PATCH /quality/checklist-items/{id}` | Update |
| `DELETE /quality/checklist-items/{id}` | Remove |
| `POST /quality/inspections` | Create inspection for a WO |
| `GET /quality/inspections` | List with filters |
| `GET /quality/inspections/{id}` | Detail with results |
| `PATCH /quality/results/{id}` | Record per-item result |
| `POST /quality/inspections/{id}/finalise` | Lock inspection + open NCRs |
| `GET /quality/ncrs` | List NCRs |
| `PATCH /quality/ncrs/{id}` | Update / close |
| `GET /quality/dashboard` | KPIs |

## 11.9 Data Model

`qc_checklist_item`, `qc_inspection`, `qc_inspection_result`, `ncr` — see [Schema §6.7](../06-database-schema.md#67-quality).

## 11.10 Integration with Work Orders

The Work Order's `status` machine enforces:

- `IN_PROGRESS → DONE` requires:
  - All stages of the WO have `WorkOrderStageProgress.STATUS = DONE`.
  - At least one `QCInspection` exists for the WO with `STATUS in (PASS, REWORK)`.
  - All open NCRs for the WO are `CLOSED`.

Attempting to advance without these conditions returns 400 with the specific gate that failed.

---

Next: [Module 12 — Machines](./12-machines.md)
