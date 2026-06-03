# Module 08 — Inventory

## 8.1 Purpose

The Inventory module tracks raw material stock on hand. It is fed primarily by GRN finalisations and depleted by production consumption (manual or auto). The module is intentionally simple in the current release — material catalog + stock quantity + adjustments — with stock movement history as the audit trail.

## 8.2 Screens

- **Inventory** (`/inventory`) — main page with:
  - **KPI tiles**: Total Materials, Total Stock Value, Low Stock, Out of Stock.
  - **Filter bar**: search, category, stock-status filter.
  - **Material grid**: cards with stock fill bar, status pill, category emoji.
  - **Detail drawer**: full material detail with movement history.
  - **Stock Adjustment modal**: receipt / issue / count adjustment with reason.

The Inventory page was rebuilt with the BVC red theme — header gradient `linear-gradient(135deg, #C8102E, #8B0B1F)`, accent gold `#F4B324`.

## 8.3 Stock Status Buckets

Each material is classified by current stock vs. reorder threshold:

| Status | Condition | UI badge |
|---|---|---|
| `OUT_OF_STOCK` | `QUANTITY <= 0` | Red |
| `LOW_STOCK` | `QUANTITY < REORDER_LEVEL` | Amber |
| `OK` | `QUANTITY >= REORDER_LEVEL` | Green |

The Low Stock and Out of Stock counts on the KPI tiles drive procurement decisions and surface on the main dashboard.

## 8.4 Category Auto-Detection

Materials are auto-categorised from their name (case-insensitive substring match) into:

- 🪙 Sheet Metal
- 🧊 Refrigeration
- ⚡ Electrical / PCB
- 🪛 Hardware / Fasteners
- 📦 Packaging
- 🖥️ Display / Screen
- 💳 Payment
- 🔩 Misc

This makes the inventory grid scannable at a glance without forcing operators to maintain a category column manually.

## 8.5 Workflow — Stock Adjustment

```
POST /inventory/{inventory_id}/adjust
{
  TYPE: "RECEIPT" | "ISSUE" | "COUNT",
  QUANTITY: 50,
  UNIT_PRICE: 120.00,  (optional, only on RECEIPT)
  REASON: "Physical stock count adjustment",
  REFERENCE: "STOCK-COUNT-2026-05"
}
```

- **RECEIPT** — adds to stock. Optional unit price updates the moving average.
- **ISSUE** — subtracts from stock. Used for material consumption against a Work Order or for sample / wastage.
- **COUNT** — sets stock to an absolute value (physical reconciliation). Difference is logged.

Each adjustment writes a stock movement entry retrievable via:

```
GET /inventory/{inventory_id}/movements
```

## 8.6 Inventory ← GRN Pipeline

The primary way stock enters inventory is through a finalised GRN:

```
POST /purchase-orders/grn/{grn_id}/finalize

For each GRN line with QUANTITY_RECEIVED > 0:
   - lookup Inventory by MATERIAL_ID (or create if missing)
   - Inventory.QUANTITY += QUANTITY_RECEIVED
   - log stock movement with REFERENCE = GRN_NUMBER
```

GRN drafts do **not** affect inventory — only finalisation does. This prevents accidental stock changes during partial delivery review.

## 8.7 Material Catalog vs. Inventory

Two related tables:

- **MaterialCatalog** (`material_catalog`) — the master list of all materials BVC can ever stock. Unique by `MATERIAL_NAME`. Vendor-agnostic (shared across tenants).
- **Inventory** (`inventory`) — the per-vendor stock record. References `MATERIAL_ID` (FK to catalog). `QUANTITY`, `UNIT_PRICE`, `VENDOR_ID`.

Adding a new material is a two-step process: create in `material_catalog`, then create an `inventory` row (or let the GRN-finalize step auto-create on first receipt).

## 8.8 Material → Department Scoping

`MaterialDepartment` is an M2M table that scopes materials to specific departments. This is used in the employee-facing screens to filter the catalog (`GET /materials/for-me`) so a welder sees only welding materials, not refrigeration parts.

## 8.9 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /materials-catalog` | Master list |
| `PUT /materials-catalog/{id}/departments` | Scope material to departments |
| `GET /materials/for-me` | Filtered by current employee's department |
| `POST /seed-materials` | Seed demo material catalog |
| `POST /create-material` | Create new material |
| `GET /materials` | List with stock |
| `PUT /update-stock/{id}` | Direct stock update (admin only) |
| `DELETE /delete-material/{id}` | Remove |
| `GET /inventory/full` | Enriched inventory list with category, status, value |
| `POST /inventory/{id}/adjust` | Stock movement (receipt / issue / count) |
| `GET /inventory/{id}/movements` | Movement history |

## 8.10 Data Model

`material_catalog`, `material_department`, `inventory` — see [Schema §6.5](../06-database-schema.md#65-inventory).

## 8.11 Total Stock Value

Computed on demand:

```
TOTAL_STOCK_VALUE = Σ (Inventory.QUANTITY × Inventory.UNIT_PRICE)
```

Surfaced on the Inventory page KPI tile and on the main dashboard.

---

Next: [Module 09 — Projects & Tasks](./09-projects-and-tasks.md)
