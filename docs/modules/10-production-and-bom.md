# Module 10 — Production & BOM

## 10.1 Purpose

This module is the heart of the manufacturing workflow. It defines:

- **Product Models** — the vending machine catalog.
- **BOM (Bill of Materials)** — what materials and processes go into one unit.
- **Process Stages** — the manufacturing flow (10 stages by default).
- **Work Orders** — production runs ("build N units of model X").
- **Work Order Stage Progress** — per-WO per-stage tracking with assignment, timestamps, status.
- **Gantt Timeline** — visual chart with Day 1–30 calendar, one-day-per-stage scheduling, Sundays as leave days.

## 10.2 Screens

- **Production** (`/production`) — three tabs: Dashboard, Machine Models, Work Orders.
- **ModelDetail** — product model with BOM (PURCHASE/PROCESS classifier), image upload per line.
- **WorkOrder Gantt Drawer** — the marquee screen of this module. Sticky header with WO metadata, four summary tiles (Progress, Planned, Actual So Far, Failed Stages), legend, then the Day 1–30 Gantt chart.

## 10.3 Product Model Catalog

A `ProductModel` represents one vending machine variant:

- BVC24 Snack & Beverage Combo (`BVC-SBC-01`)
- BVC24 Medicine Dispenser (`BVC-MED-01`)
- BVC24 Coffee & Tea Machine (`BVC-CTM-01`)
- BVC24 Smart Locker (`BVC-LCK-01`)
- etc.

Each model has:

- `MODEL_NAME`, `MODEL_CODE` (SKU), `CATEGORY`
- `ESTIMATED_BUILD_DAYS` (for scheduling estimates)
- `STATUS` (ACTIVE / DISCONTINUED)

## 10.4 BOM — Bill of Materials

A BOM line declares what goes into one unit of a product. Two essential classifiers:

### Item Type

- **`PURCHASE`** — the line is sourced from an external supplier.
  - Links to `MaterialCatalog.ID` and a `PREFERRED_SUPPLIER_ID`.
  - Feeds the auto-PO generation flow.
- **`PROCESS`** — the line is manufactured in-house at a specific stage.
  - Links to `PROCESS_STAGE_ID` (e.g., the sheet metal cabinet is fabricated during the "Sheet Metal Fabrication" stage).
  - Not sourced from suppliers, so no PO is generated.

### Per-line image

`BOMItem.IMAGE_URL` stores an uploaded reference image (assembly drawing, part photo). Uploaded via `POST /production/bom/{item_id}/upload-image`. Shown on the BOM editor so floor workers can visually confirm the right part.

### Default BOM seeder

`POST /production/models/{model_id}/seed-default-bom` creates a 10-stage manufacturing flow:

1. Design Review (4h)
2. Mechanical Design (8h)
3. Electrical Design (8h)
4. Sheet Metal Fabrication (16h)
5. Electrical Wiring (12h)
6. Component Assembly (16h)
7. Software Flashing (4h)
8. Bench Testing (8h)
9. Pre-Dispatch QC (6h)
10. Packaging & Dispatch (4h)

Total: 86 hours (~10.8 workdays at 8h/day). With one-stage-per-working-day Gantt scheduling, this maps to ~12 working days (skipping Sundays) on the timeline.

## 10.5 Process Stages

`ProcessStage` rows define the manufacturing flow per product model.

| Column | Notes |
|---|---|
| `PRODUCT_MODEL_ID` | which model this stage belongs to |
| `SEQUENCE` | 1..N (ordering) |
| `STAGE_NAME` | display name |
| `STAGE_TYPE` | enum: DESIGN, MECHANICAL, ELECTRICAL, WIRING, FABRICATION, ASSEMBLY, TESTING, QC, PACKAGING, OTHER |
| `ESTIMATED_HOURS` | reporting metric (Gantt uses 1 day per stage by default) |
| `IS_ACTIVE` | soft delete |

Stages are colour-coded in the Gantt by `STAGE_TYPE`:

| Type | Colour |
|---|---|
| DESIGN | Purple `#8b5cf6` |
| MECHANICAL | Blue `#3b82f6` |
| ELECTRICAL | Cyan `#06b6d4` |
| WIRING | Light Cyan `#0ea5e9` |
| FABRICATION | Amber `#f59e0b` |
| ASSEMBLY | Emerald `#10b981` |
| TESTING | Pink `#ec4899` |
| QC | Red `#ef4444` |
| PACKAGING | Slate `#64748b` |

## 10.6 Work Orders

A Work Order (WO) represents one production run.

### State machine

```
PLANNED → IN_PROGRESS → DONE
   │           │
   ↓           ↓
ON_HOLD     CANCELLED
```

### Creating a WO

WOs are created automatically when a Sales Order's `start-production` is called. They can also be created manually:

```
POST /production/work-orders
{ PRODUCT_MODEL_ID, PROJECT_ID, QUANTITY,
  PLANNED_START_DATE, PLANNED_END_DATE }
```

On creation, `POST /process/spawn-for-wo/{wo_id}` is invoked automatically to create one `WorkOrderStageProgress` row per active stage of the product (all `PENDING`, no assignee).

## 10.7 Stage Progress

`WorkOrderStageProgress` tracks each stage's execution:

| Column | Notes |
|---|---|
| `WORK_ORDER_ID`, `STAGE_ID` | composite identity |
| `STATUS` | `PENDING` / `IN_PROGRESS` / `DONE` / `FAILED` / `SKIPPED` |
| `ASSIGNED_TO_ID` | manually picked from the Gantt UI |
| `STARTED_AT`, `COMPLETED_AT` | actual timestamps |
| `NOTES` | append-only operator notes |

### Status updates

```
PATCH /process/wo/{wo_id}/stages/{stage_id}
{ STATUS: "IN_PROGRESS" | "DONE" | "FAILED" | "SKIPPED",
  NOTES: "...",
  ASSIGNED_TO_ID: "<employee-uuid>" }
```

Side-effects:

- `STATUS=IN_PROGRESS` and `STARTED_AT` is null → `STARTED_AT := now`.
- `STATUS in (DONE, FAILED, SKIPPED)` → `COMPLETED_AT := now`; `STARTED_AT` filled if missing.
- `NOTES` are appended with the previous→new status header.

The buttons in the Gantt row (▶ ✓ ✗) call this endpoint with the appropriate status.

## 10.8 Gantt Timeline (`GET /process/wo/{wo_id}/gantt`)

The Gantt endpoint returns a 30-day calendar timeline with one stage per working day, skipping Sundays.

### Response structure

```json
{
  "work_order_id": 2,
  "wo_number": "WO-2026-0002",
  "base_date": "2026-05-29",
  "timeline_days": 30,
  "timeline": [
    { "day_number": 1, "date": "2026-05-29",
      "weekday": "Fri", "is_sunday": false, "is_working_day": true },
    { "day_number": 2, ... },
    ...
    { "day_number": 30, "date": "2026-06-27", "weekday": "Sat", ... }
  ],
  "stages": [
    {
      "stage_id": 1, "stage_name": "Design Review",
      "stage_type": "DESIGN", "sequence": 1,
      "estimated_hours": 4, "actual_hours": null,
      "days_allocated": 1, "day_number": 1,
      "status": "PENDING",
      "planned_start": "2026-05-29T09:00:00",
      "planned_end": "2026-05-29T18:00:00",
      "planned_start_date": "2026-05-29",
      "planned_end_date": "2026-05-29",
      "actual_start": null, "actual_end": null,
      "assignee_id": null, "assignee_name": null
    },
    ...
  ],
  "total_planned_hours": 86,
  "total_actual_hours": 0,
  "completed_count": 0,
  "failed_count": 0,
  "total_stages": 10,
  "wo_status": "PLANNED"
}
```

### Scheduling rule

- **Day 1 = WO.PLANNED_START_DATE** (falls back to `ACTUAL_START_DATE` then `date.today()`).
- Each stage occupies **exactly one working day**.
- **Sundays are skipped.** If a stage falls on a Sunday, it slides to Monday.
- Sequence is respected — stage 1 then stage 2 then stage 3 on consecutive working days.

This deliberately ignores `ESTIMATED_HOURS` for visual scheduling — the hour estimate is preserved as a reporting metric, but the timeline is **one box per stage per working day**, which is far more useful for shop-floor planning than fractional-day bars.

### Auto-assignment policy

The Gantt endpoint **does not auto-assign** any employee. All stages remain `unassigned` until an admin picks one manually.

The endpoint **does sanitize stale assignments**: if any stage is currently assigned to an employee whose `NAME`, `OCCUPATION`, `SKILLS`, `Department.NAME`, `Designation.TITLE`, or `Role.ROLE_NAME` matches `sales` / `marketing` / `ragul` (case-insensitive), the assignment is cleared on the next load. This protects against accidental sales-role assignments to production stages.

## 10.9 Gantt UI

The drawer (Production page → Work Orders tab → row click → drawer opens) provides:

- **Sticky header** — WO number, product name, units, notes — always visible while scrolling.
- **Four summary tiles** — Progress %, Planned days, Actual So Far, Failed Stages.
- **Legend** — Planned (dashed), Done (green), In Progress (amber), Failed (red).
- **Day 1–30 calendar header** — numbered cells with date and weekday underneath, Sundays in red.
- **Per-row stage card** — left column: stage name, type chip, hours, "1 day", assignee chip (👤 Name (EMP123) or italic "unassigned"). Middle column: the day cell with the stage's Day number and date inside. Right column: status pill + action buttons (▶ ✓ ✗).

The drawer is `98vw` wide for maximum timeline visibility. Each day cell is ~38 px wide so all 30 days are visible without horizontal scrolling on a 1366 × 768 screen.

## 10.10 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /production/models` | Create product model |
| `GET /production/models` | List |
| `GET /production/models/{id}` | Detail |
| `PATCH /production/models/{id}` | Update |
| `DELETE /production/models/{id}` | Delete |
| `POST /production/models/{id}/seed-default-bom` | Seed 10-stage flow |
| `POST /production/models/{id}/bom` | Add BOM line |
| `GET /production/models/{id}/bom` | List BOM |
| `PATCH /production/bom/{id}` | Update |
| `DELETE /production/bom/{id}` | Remove |
| `POST /production/bom/{id}/upload-image` | Per-line image |
| `PATCH /bom-items/{id}/classify` | Set ITEM_TYPE = PURCHASE/PROCESS |
| `POST /stages` | Create process stage |
| `GET /stages/{model_id}` | List stages |
| `PATCH /stages/{id}` | Update |
| `DELETE /stages/{id}` | Remove |
| `POST /production/work-orders` | Create WO |
| `GET /production/work-orders` | List |
| `GET /production/work-orders/{id}` | Detail |
| `PATCH /production/work-orders/{id}/status` | Update status |
| `DELETE /production/work-orders/{id}` | Delete |
| `POST /process/spawn-for-wo/{id}` | Spawn stage progress |
| `GET /process/wo/{id}/stages` | List stage progress |
| `PATCH /process/wo/{id}/stages/{sid}` | Update stage progress |
| `GET /process/wo/{id}/gantt` | Gantt timeline |
| `GET /production/dashboard` | Production KPIs |

## 10.11 Data Model

`product_model`, `bom_item`, `process_stage`, `work_order`, `wo_stage_progress` — see [Schema §6.6](../06-database-schema.md#66-production).

---

Next: [Module 11 — Quality Management](./11-quality.md)
