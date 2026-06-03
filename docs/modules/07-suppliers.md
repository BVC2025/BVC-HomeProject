# Module 07 — Suppliers

## 7.1 Purpose

The Supplier module is the master record of all third-party vendors who supply raw materials, components, or services to BVC. Suppliers are referenced by:

- **BOMItem** — when a BOM line is `ITEM_TYPE = PURCHASE`, it points to a `PREFERRED_SUPPLIER_ID`.
- **PurchaseOrder** — every PO is issued to one supplier.
- **Inventory pricing** — last known supplier price is used as a fallback for auto-pricing.

## 7.2 Screens

- **Suppliers** (`/suppliers`) — directory with cards showing supplier code, company name, category, payment terms, contact person, status pill.

## 7.3 Supplier Status

`Supplier.STATUS` values:

- `ACTIVE` — eligible for new POs.
- `INACTIVE` — temporarily blocked; existing POs continue but no new ones can be created.
- `BLACKLISTED` — permanent block (quality issues, fraud, non-delivery).

The PO creation endpoint validates supplier status and returns 400 if not `ACTIVE`.

## 7.4 Categories

Suppliers are organised by category to simplify procurement search:

- Sheet Metal
- Electronics / PCBs
- Refrigeration components
- Vending mechanisms / coil systems
- Payment systems (UPI / card readers)
- Display / touch screens
- Packaging
- Logistics & shipping
- Misc

`GET /suppliers/categories` returns the current category list (configurable).

## 7.5 Workflow — Creating a supplier

```
POST /suppliers
{
  SUPPLIER_CODE: "SUP-001",
  COMPANY_NAME: "ABC Sheet Metal Pvt Ltd",
  CONTACT_PERSON: "Mr. Ramesh",
  PHONE: "+91...",
  EMAIL: "ramesh@abcsheet.in",
  GST_NUMBER: "33AAAAA0000A1Z5",
  CATEGORY: "Sheet Metal",
  PAYMENT_TERMS: "30 days net",
  STATUS: "ACTIVE",
  ADDRESS: "...",
  CITY: "Chennai",
  STATE: "Tamil Nadu",
  PINCODE: "600032"
}
```

## 7.6 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /suppliers` | Create supplier |
| `GET /suppliers` | List all (with status / category filters) |
| `GET /suppliers/categories` | Available categories |
| `GET /suppliers/{id}` | Detail |
| `PATCH /suppliers/{id}` | Update |
| `DELETE /suppliers/{id}` | Delete (blocked if any non-cancelled PO references it) |
| `GET /connect/supplier/{id}/360` | 360° view: POs, GRNs, parts supplied, performance metrics |

## 7.7 Data Model

`supplier` table — see [Schema §6.2](../06-database-schema.md#62-people).

## 7.8 Supplier Performance Tracking

`GET /connect/supplier/{id}/360` aggregates:

- **Total POs issued**
- **POs delivered on time vs. late** (compared against `EXPECTED_DELIVERY_DATE`)
- **GRN rejection rate** (sum of `QUANTITY_REJECTED` / `QUANTITY_RECEIVED`)
- **Average order value**
- **Last 10 POs** with statuses

This data feeds the procurement team's supplier scorecard. The data is computed on demand from existing tables — no materialised summary.

---

Next: [Module 08 — Inventory](./08-inventory.md)
