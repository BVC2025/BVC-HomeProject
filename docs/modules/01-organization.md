# Module 01 — Organization Management

## 1.1 Purpose

The Organization module defines the structural backbone every other module references:

- **Vendor** — the tenant (BVC).
- **Department** — functional units (Production, Sales, HR, QC, etc.).
- **Designation** — job titles (Welder, Sales Executive, Production Head) with base salary.
- **Role** — access role (`ADMIN`, `HR`, `MANAGER`, `EMPLOYEE`, etc.).
- **Permission** — fine-grained capability code (`task.assign`, `report.export`).
- **RolePermission** — M2M mapping.

Every employee record links to a department, a designation, and a role. Every customer-facing table carries the `VENDOR_ID` for multi-tenancy.

## 1.2 Screens

- **Organization** (`/organization`) — admin UI to manage departments, designations, roles, and permissions.

## 1.3 Workflows

### Creating an organisation from scratch

```
1. POST /create-vendor             — creates Vendor row
2. POST /seed-org                  — applies the MANUFACTURING preset
                                     (creates 5 standard departments,
                                      10 designations, 4 system roles,
                                      ~40 permissions)
3. POST /seed-admin                — creates the first ADMIN employee
                                     with login credentials
```

After step 3 you can log in via `POST /admin-login` with the seeded credentials and begin adding employees.

### Custom department / role creation

```
POST /departments               { CODE: "WLD", NAME: "Welding Shop", DESCRIPTION: "..." }
POST /designations              { TITLE: "Senior Welder", DEPARTMENT_ID: 5, BASE_SALARY: 32000 }
POST /roles                     { ROLE_NAME: "Welding Supervisor" }
PUT  /roles/{id}/permissions    { PERMISSION_IDS: [12, 14, 18] }
```

## 1.4 Key Endpoints

See [API Reference — Organization](../api/02-organization.md) for the complete list. Highlights:

- `GET /org-presets` — list available org templates (currently `MANUFACTURING`).
- `POST /seed-org` — apply a preset to the current vendor.
- `GET /permissions` — list all permission codes available in the system.
- `PUT /roles/{id}/permissions` — replace the permission set on a role.

## 1.5 Data Model

| Table | Key columns |
|---|---|
| `vendor` | `VENDOR_NAME` |
| `root_user` | `EMAIL`, `PASSWORD`, `VENDOR_ID` |
| `department` | `CODE`, `NAME`, `HEAD_EMPLOYEE_ID`, `VENDOR_ID` |
| `designation` | `TITLE`, `DEPARTMENT_ID`, `BASE_SALARY` |
| `role` | `ROLE_NAME`, `IS_SYSTEM` (1 = cannot delete) |
| `permission` | `CODE`, `NAME`, `CATEGORY` |
| `role_permission` | `ROLE_ID`, `PERMISSION_ID` |

See [Database Schema §6.1](../06-database-schema.md#61-organization--multi-tenancy) for column details.

## 1.6 System Roles (Seeded)

| Role | Granted To | Notes |
|---|---|---|
| `SUPER_ADMIN` | Owner / CTO | Full access including vendor management |
| `ADMIN` | MD, GM | All operational modules, no system reset |
| `HR` | HR Team | Employee + payroll + leave + performance |
| `MANAGER` | Department heads | Module-scoped: tasks, projects, attendance |
| `PRODUCTION_HEAD` | Production Manager | Work orders, BOM, quality |
| `SALES` | Sales Team | CRM, quotations, sales orders |
| `EMPLOYEE` | Floor users | Employee dashboard only |

`IS_SYSTEM=1` means the role is part of the seed and cannot be deleted; custom roles created via `POST /roles` carry `IS_SYSTEM=0`.

## 1.7 Permissions Inventory (Seeded)

Permission codes follow `<entity>.<action>` convention:

- `employee.create`, `employee.read`, `employee.update`, `employee.delete`
- `customer.create`, `customer.read`, `customer.update`, `customer.delete`
- `quotation.create`, `quotation.send`, `quotation.approve`
- `sales_order.create`, `sales_order.confirm`, `sales_order.payment`
- `purchase_order.create`, `purchase_order.send`, `purchase_order.grn`
- `task.assign`, `task.complete`, `task.approve`
- `project.create`, `project.read`
- `report.export`
- `attendance.view`, `attendance.edit`
- `payroll.generate`, `payroll.finalize`
- `settings.edit`

Currently, permission **definitions** are seeded and stored, but enforcement is at the **role level** (the backend checks `if role == "ADMIN"` rather than `if permission == "task.assign"`). Migrating to per-permission decorators is on the roadmap.

## 1.8 Multi-tenancy Guarantees

- A new vendor is created via `POST /create-vendor`.
- All subsequent rows in any tenant-scoped table carry that vendor's `ID` in their `VENDOR_ID` column.
- The JWT issued at login includes `vendor_id`. The backend filters every list query by this claim, making cross-tenant access impossible without forging the token.
- There is no shared data between vendors — even product catalogs are per-vendor (Vendor A's `ProductModel.MODEL_CODE = "X100"` is logically distinct from Vendor B's).

## 1.9 Operational Notes

- Deleting a department that has employees attached returns a 409 Conflict with the count of dependent employees.
- Deleting a role with `IS_SYSTEM=1` returns 403 Forbidden.
- Renaming a department or designation is non-disruptive — references are by FK, not by name.

---

Next: [Module 02 — Human Resources](./02-hr.md)
