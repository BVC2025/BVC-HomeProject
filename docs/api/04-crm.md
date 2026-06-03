# API — 04 CRM

## Customers

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-customer` | Create + WhatsApp MD alert |
| PATCH | `/customers/{id}` | Update |
| GET | `/customers` | List with filters |
| DELETE | `/delete-customer/{id}` | Remove |
| PATCH | `/customers/{id}/lead-status` | Move along pipeline `{ LEAD_STATUS }` |

### Customer create payload

```json
{
  "CUSTOMER_NAME": "Apollo Hospitals",
  "CONTACT_PERSON": "Mr. Suresh",
  "PHONE": "+91...",
  "EMAIL": "procurement@apollo.in",
  "GST_NUMBER": "...",
  "INDUSTRY": "Healthcare",
  "LEAD_SOURCE": "Referral",
  "LEAD_PRIORITY": "HIGH",
  "ASSIGNED_SALES_ID": "<employee-uuid>",
  "BUSINESS_TYPE": "Hospital chain",
  "NUMBER_OF_BRANCHES": 12,
  "EXPECTED_MONTHLY_ORDERS": 8,
  "BILLING_ADDRESS": "...",
  "SHIPPING_ADDRESS": "...",
  "WHATSAPP_NUMBER": "+91..."
}
```

## Enquiries

| Method | Path | Purpose |
|---|---|---|
| POST | `/customers/enquiry` | Record enquiry + WhatsApp MD alert |

## Contacts

| Method | Path | Purpose |
|---|---|---|
| POST | `/customers/{id}/contacts` | Add contact `{ NAME, PHONE, EMAIL, IS_PRIMARY }` |
| GET | `/customers/{id}/contacts` | List |
| DELETE | `/customers/{id}/contacts/{cid}` | Remove |

## Requirements

| Method | Path | Purpose |
|---|---|---|
| POST | `/customers/{id}/requirements` | Add `{ MACHINE_CATEGORY, PRODUCT_MODEL_ID, QUANTITY, TARGET_UNIT_PRICE, TARGET_DELIVERY_DATE, PRIORITY }` |
| GET | `/customers/{id}/requirements` | List |
| PATCH | `/customers/{id}/requirements/{rid}` | Update |
| DELETE | `/customers/{id}/requirements/{rid}` | Remove |
| POST | `/customers/{id}/requirements/{rid}/to-project` | Convert to project |

## 360° View

| Method | Path | Purpose |
|---|---|---|
| GET | `/connect/customer/{id}/360` | Customer, sales, quotations, projects, contacts, machines |

See [Module 03 — CRM](../modules/03-crm.md) for workflows.

---

Next: [05 — Quotations](./05-quotations.md)
