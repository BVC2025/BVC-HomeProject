# Module 12 — Machines

## 12.1 Purpose

The Machine module is the registry of **manufactured units** — the physical vending machines BVC has produced. Each row represents one serialised unit. Machines are auto-registered when a Work Order completes, and their status is tracked through the customer's installation, service, and end-of-life.

## 12.2 Screens

- **Machines** (`/machines`) — registry with status pills (Running / Idle / Maintenance), location, customer, last service date.
- **Machine detail panel** — full machine info with status log, service history, attached customer/project.

## 12.3 Data Model

### Machine (`machine`)

| Column | Notes |
|---|---|
| `MACHINE_NAME`, `MACHINE_TYPE` | e.g. "BVC-SBC-01 Unit #003" |
| `STATUS` | `IDLE` / `ACTIVE` / `MAINTENANCE` |
| `LOCATION` | customer site name / address |
| `PRODUCT_MODEL_ID` | FK → `product_model.ID` |
| `WORK_ORDER_ID` | FK → `work_order.ID` (the production batch this came from) |
| `UNIT_NUMBER` | 1..QUANTITY (when a WO produced multiple units) |
| `SERIAL_NO` | physical serial number engraved on the unit |
| `VENDOR_ID` | |

### MachineLog (`machine_log`)

| Column | Notes |
|---|---|
| `MACHINE_ID` | FK |
| `STATUS` | new status after this log entry |
| `NOTE` | what happened (e.g. "Cooling unit replaced", "Moved to Apollo Hospital, Greams Road") |
| `TIMESTAMP` | |

This is an append-only log used to reconstruct each machine's lifetime history.

## 12.4 Auto-registration from Work Orders

When a Work Order's `STATUS` advances to `DONE`, the production routes create one `Machine` row per unit:

```
For each unit in 1..WO.QUANTITY:
   create Machine(
     MACHINE_NAME = f"{model.MODEL_NAME} Unit #{unit:03d}",
     MACHINE_TYPE = model.MODEL_CODE,
     STATUS = "IDLE",
     PRODUCT_MODEL_ID, WORK_ORDER_ID, UNIT_NUMBER = unit,
     SERIAL_NO = f"{model.MODEL_CODE}-{wo.WO_NUMBER}-{unit:03d}",
     VENDOR_ID
   )
   create MachineLog(STATUS="IDLE", NOTE="Auto-registered from WO completion")
```

Each unit starts `IDLE` until shipped to a customer site, at which point its `LOCATION` is filled and `STATUS` becomes `ACTIVE`.

## 12.5 Status Transitions

```
IDLE ─ship─► ACTIVE ─service_required─► MAINTENANCE ─resolved─► ACTIVE
                  │                                          ↑
                  │                                          │
                  └──────────────── decommissioned ──────────┘
                                       (terminal)
```

Each transition writes a `MachineLog` entry. Transitions are admin-only via:

```
PUT /machines/machine-status/{machine_id}
{ STATUS: "ACTIVE" | "IDLE" | "MAINTENANCE", NOTE: "..." }
```

## 12.6 Service History

The machine log is the service history. A service visit creates a log entry:

```
PUT /machines/machine-status/<id>
{ STATUS: "MAINTENANCE", NOTE: "Field engineer Ravi visited 2026-06-15. Replaced coil motor #3. Tested 50 dispenses. OK." }

(after resolution)

PUT /machines/machine-status/<id>
{ STATUS: "ACTIVE", NOTE: "Returned to service" }
```

Phase 7 (AMC / Service module — planned) will formalise this into structured `ServiceVisit` records.

## 12.7 Sync from Production

`POST /machines/sync` is a bulk-create endpoint used after a backfill / migration to register machines for historical Work Orders that pre-date the auto-registration logic. Idempotent — skips units that already have a Machine row.

## 12.8 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /machines/create-machine` | Manual machine creation |
| `POST /machines/sync` | Bulk auto-register from existing WOs |
| `GET /machines` | List with filters |
| `PUT /machines/machine-status/{id}` | Update status + log |
| `GET /machines/machine-logs/{id}` | History |
| `DELETE /machines/delete-machine/{id}` | Remove (rare; usually a status change is preferred) |

## 12.9 360° View

`GET /connect/customer/{id}/360` includes the customer's machine fleet via the `EntityDrawer` component. Each machine shows status, serial, last service date.

---

Next: [Module 13 — Notifications](./13-notifications.md)
