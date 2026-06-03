# Module 03 — Customer Relationship Management (CRM)

## 3.1 Purpose

The CRM module is the entry point for every revenue event. It maintains a 360° view of every customer and their journey from first enquiry to closed contract.

Three primary entities:

- **Customer** — the company buying vending machines.
- **CustomerContact** — additional contact persons.
- **CustomerRequirement** — what the customer is asking for (specifies the bridge to the Quotation module).

## 3.2 Screens

- **Customers** (`/customers`) — directory with status pills, lead-status pills, priority indicators, industry emoji badges.
- **EntityDrawer** (component) — 360° side panel showing projects, machines, BOM previews for a single customer.
- **CustomerEditor** — side-panel create / edit form.
- **RequirementsManager** — manage the requirements list within a customer drawer.
- **CustomerQuotationsSection** — list of quotations attached to the customer.
- **RequirementPickerModal** — multi-select requirements when converting to a quotation.

## 3.3 Lead Pipeline

The `Customer.LEAD_STATUS` column drives the sales pipeline:

```
NEW → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED_WON
                                          ↘ CLOSED_LOST
```

- **NEW** — captured from enquiry, no qualification yet.
- **QUALIFIED** — sales rep has confirmed budget, authority, need, timeline.
- **PROPOSAL** — a Quotation has been sent.
- **NEGOTIATION** — customer responded with questions or counter-terms.
- **CLOSED_WON** — Quotation was approved → Sales Order created.
- **CLOSED_LOST** — Quotation was rejected or the lead went cold.

`PATCH /customers/{id}/lead-status` updates the pipeline state.

## 3.4 Workflow — End-to-end

```
1. POST /create-customer
   { CUSTOMER_NAME, CONTACT_PERSON, PHONE, EMAIL, INDUSTRY,
     LEAD_SOURCE, ASSIGNED_SALES_ID, EXPECTED_MONTHLY_ORDERS,
     CURRENT_VENDOR_NAME, ... }
   → Customer row, LEAD_STATUS = NEW
   → WhatsApp MD alert fired via whatsapp_service

2. POST /customers/enquiry
   { CUSTOMER_ID, ENQUIRY_NOTES }
   → activity log entry
   → WhatsApp MD alert with enquiry summary

3. POST /customers/{id}/contacts (optional, multiple)
   { NAME, PHONE, EMAIL, IS_PRIMARY }
   → CustomerContact rows

4. POST /customers/{id}/requirements
   { MACHINE_CATEGORY, PRODUCT_MODEL_ID, QUANTITY,
     TARGET_UNIT_PRICE, TARGET_DELIVERY_DATE, PRIORITY }
   → CustomerRequirement row, STATUS = DRAFT

5. PATCH /customers/{id}/lead-status { LEAD_STATUS: QUALIFIED }

6. POST /quotations/from-requirements
   { CUSTOMER_ID, REQUIREMENT_IDS: [...] }
   → see Quotation module

7. (Later) PATCH /customers/{id}/lead-status { LEAD_STATUS: CLOSED_WON }
   when the SO is created.
```

## 3.5 WhatsApp MD Alerts

Two events in this module trigger an automatic WhatsApp message to the Managing Director:

| Event | Endpoint | Message includes |
|---|---|---|
| New customer / lead created | `POST /create-customer` | Customer name, industry, contact, ASSIGNED_SALES name |
| New enquiry recorded | `POST /customers/enquiry` | Customer, enquiry notes, expected monthly orders |

The MD's WhatsApp number is configured via `MD_WHATSAPP_NUMBER`. The transport is selected by `whatsapp_service.py`:

- **CallMeBot first** (free, requires `CALLMEBOT_API_KEY` + a one-time "join" message).
- **WhatsApp Cloud API fallback** (requires `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`).

If neither is configured, the operation continues without failure — a warning is logged.

## 3.6 Convert Requirement → Project

A shortcut is provided to convert a customer requirement directly into a Project (skipping quotation):

```
POST /customers/{cid}/requirements/{rid}/to-project
```

This invokes `project_from_product_service.create_project_from_product()`, which:

1. Creates a Project row tied to the customer and product model.
2. Spawns Task rows from the product's process stages.
3. Sets `CustomerRequirement.STATUS = ORDERED`.

This path is used when an existing customer commits to an order without needing a formal quotation cycle.

## 3.7 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /create-customer` | Create customer + WhatsApp MD alert |
| `PATCH /customers/{id}` | Update customer |
| `GET /customers` | List with filters |
| `POST /customers/enquiry` | Record enquiry + WhatsApp MD alert |
| `PATCH /customers/{id}/lead-status` | Move along pipeline |
| `POST /customers/{id}/contacts` | Add contact person |
| `GET /customers/{id}/contacts` | List contacts |
| `DELETE /customers/{id}/contacts/{cid}` | Remove contact |
| `POST /customers/{id}/requirements` | Add requirement |
| `GET /customers/{id}/requirements` | List requirements |
| `PATCH /customers/{id}/requirements/{rid}` | Edit |
| `DELETE /customers/{id}/requirements/{rid}` | Remove |
| `POST /customers/{cid}/requirements/{rid}/to-project` | Convert to project |
| `GET /connect/customer/{id}/360` | 360° view (projects, SOs, quotations, contacts) |

## 3.8 Data Model

`customer`, `customer_contact`, `customer_requirement` — see [Schema §6.2](../06-database-schema.md#62-people) and [§6.3](../06-database-schema.md#63-sales).

## 3.9 Customer Type & Qualification Fields

The customer record captures B2B qualification data that helps prioritise leads:

- `BUSINESS_TYPE` — hospital, corporate office, hotel, school, factory, etc.
- `NUMBER_OF_BRANCHES` — scale signal
- `EXPECTED_MONTHLY_ORDERS` — revenue projection
- `EXISTING_MACHINE_USAGE` — competitive context
- `CURRENT_VENDOR_NAME` — incumbent supplier
- `LEAD_PRIORITY` — `HIGH` / `MEDIUM` / `LOW`
- `LEAD_SOURCE` — referral, website, exhibition, cold call, etc.
- `FOLLOW_UP_DATE`, `NEXT_MEETING_DATE` — sales rep reminders

These columns feed the lead dashboard and the MD review screens.

---

Next: [Module 04 — Quotations](./04-quotations.md)
