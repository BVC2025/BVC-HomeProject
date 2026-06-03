# API — 02 Organization

All endpoints require authentication and apply tenant filtering by `VENDOR_ID`.

## Departments

| Method | Path | Purpose |
|---|---|---|
| GET | `/departments` | List departments for current vendor |
| POST | `/departments` | Create `{ CODE, NAME, DESCRIPTION, HEAD_EMPLOYEE_ID? }` |
| PUT | `/departments/{id}` | Update |
| DELETE | `/departments/{id}` | Delete (409 if employees attached) |

## Designations

| Method | Path | Purpose |
|---|---|---|
| GET | `/designations` | List |
| POST | `/designations` | Create `{ TITLE, DEPARTMENT_ID, BASE_SALARY, DESCRIPTION }` |
| PUT | `/designations/{id}` | Update |
| DELETE | `/designations/{id}` | Delete |

## Roles & Permissions

| Method | Path | Purpose |
|---|---|---|
| GET | `/roles` | List roles |
| POST | `/roles` | Create `{ ROLE_NAME, DESCRIPTION }` |
| DELETE | `/roles/{id}` | Delete (403 if `IS_SYSTEM=1`) |
| GET | `/permissions` | List all permission codes |
| PUT | `/roles/{id}/permissions` | Set role's permissions `{ PERMISSION_IDS: [...] }` |

## Seeding

| Method | Path | Purpose |
|---|---|---|
| GET | `/org-presets` | List available templates (currently `MANUFACTURING`) |
| POST | `/seed-org` | Apply the MANUFACTURING preset to current vendor |

## Vendors

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-vendor` | Create new tenant `{ VENDOR_NAME }` |
| GET | `/vendors` | List vendors |

## Users (legacy)

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-role` | Legacy alias — prefer `/roles` |

See [Module 01 — Organization](../modules/01-organization.md) for context.

---

Next: [03 — HR](./03-hr.md)
