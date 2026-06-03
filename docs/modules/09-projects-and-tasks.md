# Module 09 — Projects & Tasks

## 9.1 Purpose

Projects are the **execution containers** between a sale and a delivered machine. One Sales Order line spawns one Project. Inside each Project lives a hierarchy:

```
Project ─┬── Task                     (immediate, status-driven)
         ├── TaskAssignment           (formal allocation with approval)
         ├── WorkOrder(s)             (production runs from this project)
         └── PurchaseOrder(s)         (procurement against this project)
```

Tasks are the unit of daily work. They are assigned to employees, completed by them, and contribute to monthly STAR performance scores.

## 9.2 Screens

- **Projects** (`/projects`) — project list with cards (stage progress, BOM preview, task counts, customer link).
- **Project drawer** — full project detail with tasks, BOM, attached POs.
- **Tasks** (`/tasks`) — admin Kanban-style task board across all projects.
- **EmployeeDashboard** — employee-facing today/pending/completed/by-date task views.

## 9.3 Project Templates

The system supports template-driven project creation:

- **ProjectCategory** — e.g. "Vending Machine Manufacturing", "Installation", "AMC Service Visit".
- **SubProjectTemplate** — concrete templates within a category, with `ESTIMATED_TOTAL_DAYS`.

A project created from a template inherits the estimated duration and any default task structure (currently text only — full task templates are on the roadmap).

## 9.4 Workflow — Project from SO line

This is the primary path:

```
1. Customer pays SO advance → SO.STATUS=CONFIRMED
2. Admin clicks "Start Production" on SODetail
3. For each SO line with PRODUCT_MODEL_ID:
   project_from_product_service.create_project_from_product(
       customer_id, product_model_id, quantity,
       target_date, notes, vendor_id
   )

   Inside the service:
   - Create Project row:
       PROJECT_NAME = f"{model.MODEL_NAME} for {customer.CUSTOMER_NAME}"
       CUSTOMER_ID, PRODUCT_MODEL_ID, QUANTITY
       STATUS = "PENDING"
       PRIORITY = "MEDIUM"
   - Fetch product's process stages (sorted by SEQUENCE)
   - For each stage:
     - Create Task:
         TASK_NAME = stage.STAGE_NAME
         PROJECT_ID, ASSIGNED_TO = None  (unassigned)
         STATUS = "PENDING"
     - Optionally create TaskAssignment for tracked allocation
   - Create WorkOrder:
       PRODUCT_MODEL_ID, PROJECT_ID, QUANTITY
       STATUS = "PLANNED"
   - Trigger spawn-for-wo to create WorkOrderStageProgress rows
   - Return project ID for SO line's SPAWNED_PROJECT_ID
```

## 9.5 Workflow — Project from Customer Requirement

For customers who skip the formal quotation cycle:

```
POST /customers/{cid}/requirements/{rid}/to-project
```

Same `project_from_product_service` is invoked. The `CustomerRequirement.STATUS` becomes `ORDERED`.

## 9.6 Workflow — Manual Project

For internal projects (R&D, factory upgrades, sample builds):

```
POST /create-project
{ PROJECT_NAME, DESCRIPTION, DEPARTMENT_ID,
  CUSTOMER_ID, PRODUCT_MODEL_ID (optional),
  QUANTITY, TARGET_DATE, PRIORITY,
  SKILLS_REQUIRED, SUB_PROJECT_TEMPLATE_ID (optional) }
```

## 9.7 Task Assignment Workflow

Tasks have two assignment paths:

### Direct assignment (admin)

```
PUT /task-assignment/{task_id}
{ EMPLOYEE_ID }
```

Records `Task.ASSIGNED_TO` and a `TaskAssignment` row in `PENDING_APPROVAL` state. Triggers an approval email via `approval_service.py`.

### Auto-assignment via workload

```
POST /task-assignment
{ TASK_NAME, PROJECT_ID, AUTO_ASSIGN: true,
  SKILLS_REQUIRED, DUE_DATE }
```

Uses `workload_service.py`:

1. Filter active employees by skills match.
2. Compute current workload (count of pending tasks per employee).
3. Pick the least-loaded employee.
4. Create `TaskAssignment` and send approval email.

### Approval flow

Each `TaskAssignment` carries `APPROVAL_TOKEN` (32-char URL-safe random). The approval email contains two single-click links:

```
GET /approve-task?token=...
GET /reject-task?token=...
```

The approver (admin / manager) clicks from email. The backend renders an HTML decision page and sets `APPROVAL_STATUS`, `APPROVAL_RESOLVED_AT`. The employee receives a notification.

Expired (>7 day) tokens are cleaned up by:

```
POST /task-proposals/cleanup-expired
```

## 9.8 Employee Acceptance Flow

After admin approval, the assigned employee must accept or reject the task from their dashboard:

```
PATCH /task-assignment/{task_id}/accept   → TASK_STATUS = ACCEPTED
PATCH /task-assignment/{task_id}/reject   → TASK_STATUS = REJECTED
                                            + REJECTION_REASON
```

This second-gate prevents tasks from being silently dropped on employees who are unavailable.

## 9.9 Task Lifecycle

```
PENDING_APPROVAL → APPROVED → ACCEPTED → IN_PROGRESS → COMPLETED
                            ↘ REJECTED
                              REJECTED (by approver)
                              EXPIRED
```

Status transitions:

- `PUT /start-task/{task_id}` — IN_PROGRESS, sets `START_TIME`.
- `PUT /complete-task/{task_id}` — COMPLETED, sets `END_TIME`, contributes to payroll TASK_BONUS and STAR performance.
- `PUT /hold-task/{task_id}` — ON_HOLD with reason.

## 9.10 Daily Allocation

`DailyAllocation` is the AI allocator's output: which employee gets which task on which day, in what order. Currently:

- Triggered by `allocation_service.py` (manual or cron).
- Inputs: pending tasks, employee skills, current attendance, workload, leave plans.
- Output: rows in `daily_allocation` with `SCORE`, `SCORE_BREAKDOWN`, `REASON`.

The employee dashboard's "Today's Tasks" reads from this table. If no allocations exist for the day, it falls back to `TaskAssignment.ASSIGNED_DATE = today`.

## 9.11 Pending-from-yesterday Banner

`GET /employee/{ref}/pending-from-yesterday` returns tasks that were assigned for yesterday and are still not `COMPLETED`. These appear as a yellow banner on the employee dashboard the next morning, encouraging carryover or rescheduling.

## 9.12 Key Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /create-project` | Create manual project |
| `POST /projects/from-product` | Create project from product model (used by SO) |
| `POST /projects/{id}/backfill-tasks` | Spawn missing tasks from process stages |
| `POST /projects/auto-assign-missing` | Auto-assign unassigned tasks |
| `GET /projects` | List projects |
| `PATCH /projects/{id}/status` | Update project status |
| `DELETE /delete-project/{id}` | Remove |
| `POST /create-task` | Create task |
| `GET /tasks` | List tasks |
| `PUT /start-task/{id}` | Start |
| `PUT /complete-task/{id}` | Complete |
| `PUT /hold-task/{id}` | Hold |
| `POST /task-assignment` | Manually or auto-assign |
| `PATCH /task-assignment/{id}/accept` | Employee accepts |
| `PATCH /task-assignment/{id}/reject` | Employee rejects |
| `GET /employee/{ref}/today-task` | Today's tasks |
| `GET /employee/{ref}/pending-acceptance` | Tasks awaiting employee decision |
| `GET /employee/{ref}/pending-from-yesterday` | Carryover |
| `GET /workload-preview` | Predicted workload |
| `GET /approve-task?token=...` | Email-link approval |
| `GET /reject-task?token=...` | Email-link rejection |
| `POST /task-proposals/cleanup-expired` | Cron cleanup |
| `GET /connect/project/{id}/360` | 360° view |

## 9.13 Data Model

`project`, `task`, `task_assignment`, `daily_allocation`, `project_category`, `sub_project_template` — see [Schema §6.8](../06-database-schema.md#68-projects--tasks).

---

Next: [Module 10 — Production & BOM](./10-production-and-bom.md)
