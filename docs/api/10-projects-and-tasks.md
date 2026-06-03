# API — 10 Projects & Tasks

## Projects

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-project` | Manual project create |
| POST | `/projects/from-product` | Create project from product model (used by SO start-production) |
| POST | `/projects/{id}/backfill-tasks` | Spawn tasks from process stages |
| POST | `/projects/auto-assign-missing` | Auto-assign unassigned tasks |
| GET | `/projects` | List with filters |
| PATCH | `/projects/{id}/status` | Update status |
| DELETE | `/delete-project/{id}` | Remove |
| GET | `/connect/project/{id}/360` | 360° view — customer, tasks, team, WOs |
| POST | `/projects/wipe-all` | Dev — clear all |

## Project Templates

| Method | Path | Purpose |
|---|---|---|
| GET | `/project-sections` | Available sections |
| GET | `/project-categories` | Categories |
| POST | `/project-categories` | Create category |
| DELETE | `/project-categories/{id}` | Remove |
| GET | `/sub-project-templates` | Templates |
| POST | `/sub-project-templates` | Create template |
| DELETE | `/sub-project-templates/{id}` | Remove |
| POST | `/seed-project-templates` | Seed (dev) |

## Tasks

| Method | Path | Purpose |
|---|---|---|
| POST | `/create-task` | Create |
| GET | `/tasks` | List |
| PUT | `/start-task/{id}` | IN_PROGRESS, sets START_TIME |
| PUT | `/complete-task/{id}` | COMPLETED, sets END_TIME |
| PUT | `/hold-task/{id}` | ON_HOLD |
| GET | `/project/{id}/tasks` | Tasks for a project |

## Task Assignment

| Method | Path | Purpose |
|---|---|---|
| POST | `/task-assignment` | Manual or auto-assign `{ TASK_NAME, PROJECT_ID, EMPLOYEE_ID?, AUTO_ASSIGN?, SKILLS_REQUIRED?, DUE_DATE }` |
| PUT | `/task-assignment/{id}/status` | Update status |
| PATCH | `/task-assignment/{id}/accept` | Employee accepts |
| PATCH | `/task-assignment/{id}/reject` | Employee rejects `{ REJECTION_REASON }` |
| DELETE | `/task-assignment/{id}` | Remove |
| GET | `/workload-preview` | Predicted workload by employee |

## Token-based Approvals

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/approve-task?token=...` | None | Email link — HTML approval page |
| GET | `/reject-task?token=...` | None | Email link — HTML rejection page |
| POST | `/task-proposals/cleanup-expired` | Admin | Delete stale tokens (>7 days) |
| GET | `/task-proposals/pending` | Admin | List pending approvals |

## Employee Task Views

| Method | Path | Purpose |
|---|---|---|
| GET | `/employee/{ref}/today-task` | Today's tasks |
| GET | `/employee/{ref}/tasks` | All assigned |
| GET | `/employee/{ref}/all-tasks` | All including past |
| GET | `/employee/{ref}/pending-from-yesterday` | Carryover |
| GET | `/employee/{ref}/pending-acceptance` | Awaiting employee decision |

## Mock Date (testing)

| Method | Path | Purpose |
|---|---|---|
| GET | `/current-day` | Current day |
| PUT | `/current-day` | Set mock date |

See [Module 09 — Projects & Tasks](../modules/09-projects-and-tasks.md) for full workflow.

---

Next: [11 — Production & Process](./11-production-and-process.md)
