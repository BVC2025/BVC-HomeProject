# API — 08 Suppliers

| Method | Path | Purpose |
|---|---|---|
| POST | `/suppliers` | Create |
| GET | `/suppliers` | List with optional `?status=&category=` |
| GET | `/suppliers/categories` | List categories |
| GET | `/suppliers/{id}` | Detail |
| PATCH | `/suppliers/{id}` | Update |
| DELETE | `/suppliers/{id}` | Delete (409 if active POs reference it) |
| GET | `/connect/supplier/{id}/360` | 360° view — POs, GRNs, parts, performance |

### Create payload

```json
{
  "SUPPLIER_CODE": "SUP-001",
  "COMPANY_NAME": "ABC Sheet Metal Pvt Ltd",
  "CONTACT_PERSON": "Mr. Ramesh",
  "PHONE": "+91...", "EMAIL": "ramesh@abcsheet.in",
  "GST_NUMBER": "33AAAAA0000A1Z5",
  "CATEGORY": "Sheet Metal",
  "PAYMENT_TERMS": "30 days net",
  "STATUS": "ACTIVE",
  "ADDRESS": "...", "CITY": "Chennai", "STATE": "Tamil Nadu", "PINCODE": "600032"
}
```

See [Module 07 — Suppliers](../modules/07-suppliers.md).

---

Next: [09 — Inventory](./09-inventory.md)
