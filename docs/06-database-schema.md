# 06 — Database Schema

The MySQL schema is defined entirely in `backend/app/models/models.py` as SQLAlchemy ORM classes. Tables are created on first run via `Base.metadata.create_all()`; subsequent additive changes are applied by the idempotent auto-migration block in `app/main.py`.

This chapter is a **data dictionary** — grouped by functional domain, showing the important columns and foreign keys. Columns that are generic (`ID`, `CREATED_AT`, `UPDATED_AT`) are omitted unless they carry behaviour worth noting.

## 6.1 Organization & Multi-tenancy

| Model | Table | Purpose |
|---|---|---|
| **Vendor** | `vendor` | Tenant master (one row per SaaS customer; currently `BVC` is row 1). Key column: `VENDOR_NAME`. |
| **RootUser** | `root_user` | Tenant administrator account. `EMAIL`, `PASSWORD`, `VENDOR_ID → vendor.ID`. |
| **Department** | `department` | Org units within a vendor. `CODE`, `NAME`, `HEAD_EMPLOYEE_ID`, `VENDOR_ID`. |
| **Designation** | `designation` | Job titles with base salary. `TITLE`, `DEPARTMENT_ID`, `BASE_SALARY`, `VENDOR_ID`. |
| **Role** | `role` | Access role (system or custom). `ROLE_NAME`, `IS_SYSTEM`, `VENDOR_ID`. |
| **Permission** | `permission` | Fine-grained capability codes (e.g. `task.assign`). `CODE`, `NAME`. |
| **RolePermission** | `role_permission` | M2M Role↔Permission. |

## 6.2 People

### Employee (`employee`)

The unified employee record (replaces legacy `iam_user` and `employee_account`).

| Column | Type | Notes |
|---|---|---|
| `ID` | String(36) | UUID PK |
| `EMPLOYEE_CODE` | String(20) | Unique login handle (e.g. `EMP001`, `ADMIN`) |
| `NAME`, `EMAIL`, `PHONE` | string | |
| `PASSWORD` | String(255) | bcrypt hash |
| `DEPARTMENT_ID` | FK → `department.ID` | |
| `DESIGNATION_ID` | FK → `designation.ID` | |
| `ROLE_ID` | FK → `role.ID` | |
| `REPORTING_MANAGER_ID` | FK → `employee.ID` | self-reference |
| `JOINING_DATE`, `SALARY` | Date / Float | |
| `SHIFT_START`, `SHIFT_END` | Time | default 10:00 / 18:00 |
| `STATUS` | String(20) | `ACTIVE` / `SUSPENDED` / `RESIGNED` / `TERMINATED` |
| `FINGERPRINT_ID` | String(50), unique | maps to biometric device USER_ID |
| `PROFILE_SUBMITTED` | Int (0/1) | gate flag — locks self-registration form once submitted |
| `SKILLS` | String(500) | comma-separated tags |
| Profile fields | `ADDRESS`, `CITY`, `STATE`, `PINCODE`, `DOB`, `GENDER`, `FATHER_NAME`, `MOTHER_NAME`, `MARITAL_STATUS`, `OCCUPATION`, `QUALIFICATION`, `YEAR_OF_PASSING`, `EXPERIENCE_YEARS`, `EXPERIENCE_DETAILS`, `PAST_PROJECTS`, `EMPLOYMENT_TYPE`, `NOTES`, `PHOTO_URL` |
| `VENDOR_ID` | FK → `vendor.ID` | |

### Customer (`customer`)

| Column | Notes |
|---|---|
| `CUSTOMER_CODE`, `CUSTOMER_NAME`, `CONTACT_PERSON`, `PHONE`, `EMAIL`, `GST_NUMBER` | |
| `INDUSTRY`, `CUSTOMER_TYPE`, `BUSINESS_TYPE` | |
| `STATUS` | `LEAD` / `PROSPECT` / `ACTIVE` / `INACTIVE` |
| `LEAD_STATUS` | `NEW` / `QUALIFIED` / `PROPOSAL` / `NEGOTIATION` / `CLOSED_WON` / `CLOSED_LOST` |
| `LEAD_SOURCE`, `LEAD_PRIORITY`, `LEAD_CREATED_DATE`, `FOLLOW_UP_DATE`, `NEXT_MEETING_DATE` | |
| `ASSIGNED_SALES_ID` | FK → `employee.ID` |
| `NUMBER_OF_BRANCHES`, `EXPECTED_MONTHLY_ORDERS`, `EXISTING_MACHINE_USAGE`, `CURRENT_VENDOR_NAME` | qualification fields |
| `BILLING_ADDRESS`, `SHIPPING_ADDRESS`, `WHATSAPP_NUMBER`, `GOOGLE_MAP_LOCATION` | |
| `REQUIREMENT_NOTES` | |
| `VENDOR_ID` | |

### CustomerContact (`customer_contact`)

Additional contact persons for a customer. `CUSTOMER_ID`, `NAME`, `PHONE`, `IS_PRIMARY`.

### CustomerRequirement (`customer_requirement`)

Captured during enquiry, fed forward into quotations.

| Column | Notes |
|---|---|
| `CUSTOMER_ID` | FK → `customer.ID` |
| `MACHINE_CATEGORY` | free text (snack, beverage, etc.) |
| `PRODUCT_MODEL_ID` | FK → `product_model.ID` (optional — set once matched) |
| `QUANTITY`, `TARGET_UNIT_PRICE`, `TARGET_DELIVERY_DATE` | |
| `STATUS` | `DRAFT` / `CONFIRMED` / `QUOTED` / `ORDERED` / `CANCELLED` |
| `PRIORITY` | `HIGH` / `MEDIUM` / `LOW` |

### Supplier (`supplier`)

`SUPPLIER_CODE`, `COMPANY_NAME`, `CONTACT_PERSON`, `PHONE`, `EMAIL`, `GST_NUMBER`, `CATEGORY`, `PAYMENT_TERMS`, `STATUS` (`ACTIVE` / `INACTIVE` / `BLACKLISTED`), `VENDOR_ID`.

## 6.3 Sales

### Quotation (`quotation`)

| Column | Notes |
|---|---|
| `QUOTATION_NUMBER` | unique, format `QUO-YYYY-####` |
| `CUSTOMER_ID` | FK |
| `QUOTATION_DATE`, `VALIDITY_DAYS`, `EXPIRY_DATE` | |
| `STATUS` | `DRAFT` / `SENT` / `APPROVED` / `REJECTED` / `CONVERTED` / `EXPIRED` |
| `SUBTOTAL`, `DISCOUNT_PERCENT`, `DISCOUNT_AMOUNT`, `TAX_PERCENT` (default 18.0), `TAX_AMOUNT`, `GRAND_TOTAL` | |
| `PREPARED_BY` | FK → `employee.ID` |
| `PUBLIC_TOKEN` | URL-safe token for public share link |
| `EMAIL_SENT_AT`, `EMAIL_SENT_COUNT`, `LAST_EMAIL_STATUS` | |
| `VIEWED_AT`, `LAST_VIEWED_AT`, `VIEW_COUNT` | customer view telemetry |
| `VENDOR_ID` | |

### QuotationLine (`quotation_line`)

One product line on a quotation. `QUOTATION_ID`, `PRODUCT_MODEL_ID`, `REQUIREMENT_ID` (FK → `customer_requirement.ID`), `DESCRIPTION`, `HSN_CODE`, `QUANTITY`, `UNIT`, `UNIT_PRICE`, `DISCOUNT_PERCENT`, `LINE_TOTAL`, `SORT_ORDER`.

### QuotationActivity (`quotation_activity`)

Audit timeline. `QUOTATION_ID`, `EVENT_TYPE`, `EVENT_DETAIL`, `ACTOR_TYPE`, `ACTOR_NAME`, `CREATED_AT`.

### SalesOrder (`sales_order`)

| Column | Notes |
|---|---|
| `SO_NUMBER` | unique, format `SO-YYYY-####` |
| `CUSTOMER_ID`, `QUOTATION_ID` | FKs |
| `SO_DATE`, `EXPECTED_DELIVERY_DATE` | |
| **`ADVANCE_DUE_DATE`** | **date the customer must pay the advance by; defaults to SO_DATE + 7 days** |
| `STATUS` | `DRAFT` / **`AWAITING_ADVANCE`** / `CONFIRMED` / `IN_PRODUCTION` / `SHIPPED` / `DELIVERED` / `CLOSED` / `CANCELLED` |
| `SUBTOTAL`, `DISCOUNT_PERCENT`, `DISCOUNT_AMOUNT`, `TAX_PERCENT`, `TAX_AMOUNT`, `GRAND_TOTAL` | |
| `ADVANCE_PERCENT` (50), `DISPATCH_PERCENT` (40), `INSTALLATION_PERCENT` (10) | payment milestones |
| `ADVANCE_RECEIVED`, `DISPATCH_RECEIVED`, `INSTALLATION_RECEIVED` | running totals |
| `PREPARED_BY` | FK → `employee.ID` |
| `CONFIRMED_AT`, `PRODUCTION_STARTED_AT`, `SHIPPED_AT`, `DELIVERED_AT`, `CLOSED_AT`, `CANCELLED_AT` | |
| `CANCEL_REASON`, `SHIPPING_ADDRESS`, `BILLING_ADDRESS`, `TERMS_AND_CONDITIONS`, `NOTES` | |
| `EMAIL_SENT_AT`, `EMAIL_SENT_COUNT`, `LAST_EMAIL_STATUS` | |
| `VENDOR_ID` | |

### SalesOrderLine (`sales_order_line`)

`SO_ID`, `PRODUCT_MODEL_ID`, `QUOTATION_LINE_ID`, **`SPAWNED_PROJECT_ID`** (FK → `project.ID` — set when production starts), `DESCRIPTION`, `HSN_CODE`, `QUANTITY`, `UNIT`, `UNIT_PRICE`, `DISCOUNT_PERCENT`, `LINE_TOTAL`, `SORT_ORDER`.

### SalesOrderActivity (`sales_order_activity`)

`SO_ID`, `EVENT_TYPE`, `EVENT_DETAIL`, `ACTOR_TYPE`, `ACTOR_NAME`.

## 6.4 Purchase

### PurchaseOrder (`purchase_order`)

| Column | Notes |
|---|---|
| `PO_NUMBER` | unique |
| `SUPPLIER_ID` | FK |
| `PO_DATE`, `EXPECTED_DELIVERY_DATE` | |
| `STATUS` | `DRAFT` / `SENT` / `CONFIRMED` / `PARTIAL_RECEIVED` / `RECEIVED` / `CANCELLED` |
| Pricing columns | as per SO |
| `DELIVERY_ADDRESS`, `LINKED_PROJECT_ID` (FK → `project.ID`), `PREPARED_BY` (FK → `employee.ID`) | |
| `SENT_AT`, `CONFIRMED_AT`, `CANCELLED_AT` | |
| `EMAIL_SENT_AT`, `EMAIL_SENT_COUNT`, `LAST_EMAIL_STATUS` | |
| `VENDOR_ID` | |

### PurchaseOrderLine (`purchase_order_line`)

`PO_ID`, `MATERIAL_ID` (FK → `material_catalog.ID`), `BOM_ITEM_ID` (FK → `bom_item.ID`), `DESCRIPTION`, `QUANTITY`, `QUANTITY_RECEIVED`, `UNIT`, `UNIT_PRICE`, `DISCOUNT_PERCENT`, `LINE_TOTAL`.

### GoodsReceiptNote (`goods_receipt_note`)

| Column | Notes |
|---|---|
| `GRN_NUMBER` | unique |
| `PO_ID` | FK |
| `RECEIVED_DATE`, `RECEIVED_BY` (FK → `employee.ID`) | |
| `STATUS` | `DRAFT` / `FINAL` — only FINAL pushes to inventory |
| `INVOICE_NUMBER` | supplier's invoice ref |
| `VENDOR_ID` | |

### GoodsReceiptLine (`goods_receipt_line`)

`GRN_ID`, `PO_LINE_ID`, `QUANTITY_RECEIVED`, `QUANTITY_REJECTED`, `REJECTION_REASON`.

### PurchaseOrderActivity (`purchase_order_activity`)

`PO_ID`, `EVENT_TYPE`, `EVENT_DETAIL`, `ACTOR_TYPE`, `ACTOR_NAME`.

## 6.5 Inventory

| Model | Table | Notes |
|---|---|---|
| **MaterialCatalog** | `material_catalog` | Master list of materials. `MATERIAL_NAME` (unique). |
| **MaterialDepartment** | `material_department` | M2M material↔department for access scoping. |
| **Inventory** | `inventory` | Per-vendor stock. `MATERIAL_ID`, `MATERIAL_NAME`, `QUANTITY`, `UNIT_PRICE`, `VENDOR_ID`. |

> Stock-movement history is currently derived from GRN finalisations and `Inventory.adjust` calls (the dedicated `stock_movement` audit table is on the roadmap — short term, `inventory.adjust` logs to notification + activity).

## 6.6 Production

### ProductModel (`product_model`)

Catalog of vending machine variants.

| Column | Notes |
|---|---|
| `MODEL_NAME`, `MODEL_CODE` (SKU) | |
| `CATEGORY`, `DESCRIPTION` | |
| `ESTIMATED_BUILD_DAYS` | for scheduling |
| `STATUS` | `ACTIVE` / `DISCONTINUED` |
| `VENDOR_ID` | |

### BOMItem (`bom_item`)

Bill of materials line — what goes into one unit.

| Column | Notes |
|---|---|
| `PRODUCT_MODEL_ID` | FK |
| `MATERIAL_ID` | FK → `material_catalog.ID` (nullable when free-text) |
| `MATERIAL_NAME` | snapshot |
| `QUANTITY`, `UNIT` | |
| **`ITEM_TYPE`** | `PURCHASE` (sourced) or `PROCESS` (made in-house) |
| `PREFERRED_SUPPLIER_ID` | FK → `supplier.ID` (when PURCHASE) |
| `PROCESS_STAGE_ID` | FK → `process_stage.ID` (when PROCESS) |
| `ITEM_NO`, `IMAGE_URL` | |

### ProcessStage (`process_stage`)

The 10-step manufacturing flow per product (Design → Mechanical → Electrical → Wiring → Fabrication → Assembly → Software Flashing → Bench Testing → Pre-Dispatch QC → Packaging by default).

| Column | Notes |
|---|---|
| `PRODUCT_MODEL_ID` | FK |
| `SEQUENCE` | 1..N |
| `STAGE_NAME` | display name |
| `STAGE_TYPE` | `DESIGN` / `MECHANICAL` / `ELECTRICAL` / `WIRING` / `FABRICATION` / `ASSEMBLY` / `TESTING` / `QC` / `PACKAGING` / `OTHER` |
| `ESTIMATED_HOURS` | for hour-based reporting (Gantt uses 1 working day per stage by default) |
| `IS_ACTIVE` | soft delete |

### WorkOrder (`work_order`)

Production run.

| Column | Notes |
|---|---|
| `WO_NUMBER` | unique |
| `PRODUCT_MODEL_ID`, `PROJECT_ID` | FKs |
| `QUANTITY` | units to build |
| `STATUS` | `PLANNED` / `IN_PROGRESS` / `ON_HOLD` / `DONE` / `CANCELLED` |
| `PLANNED_START_DATE`, `PLANNED_END_DATE`, `ACTUAL_START_DATE`, `ACTUAL_END_DATE` | |
| `VENDOR_ID` | |

### WorkOrderStageProgress (`wo_stage_progress`)

Per-WO per-Stage progress row, spawned by `POST /process/spawn-for-wo/{wo_id}`.

| Column | Notes |
|---|---|
| `WORK_ORDER_ID`, `STAGE_ID` | FKs |
| `STATUS` | `PENDING` / `IN_PROGRESS` / `DONE` / `FAILED` / `SKIPPED` |
| `ASSIGNED_TO_ID` | FK → `employee.ID` (manual assignment) |
| `STARTED_AT`, `COMPLETED_AT` | actual timestamps |
| `NOTES` | append-only operator notes |

### Machine (`machine`)

Manufactured units (auto-registered when a WO completes).

| Column | Notes |
|---|---|
| `MACHINE_NAME`, `MACHINE_TYPE`, `STATUS` (`IDLE`/`ACTIVE`/`MAINTENANCE`), `LOCATION` | |
| `PRODUCT_MODEL_ID`, `WORK_ORDER_ID` | FKs |
| `UNIT_NUMBER` | 1..QUANTITY when WO produces multiple units |
| `SERIAL_NO` | |
| `VENDOR_ID` | |

### MachineLog (`machine_log`)

`MACHINE_ID`, `STATUS`, `NOTE`, `TIMESTAMP`.

## 6.7 Quality

### QCChecklistItem (`qc_checklist_item`)

Template — one inspection point per ProductModel.

| Column | Notes |
|---|---|
| `PRODUCT_MODEL_ID` | FK |
| `SEQUENCE`, `CHECK_POINT`, `DESCRIPTION` | |
| `SEVERITY` | `CRITICAL` / `MAJOR` / `MINOR` |
| `IS_ACTIVE` | |

### QCInspection (`qc_inspection`)

One inspection per Work Order.

| Column | Notes |
|---|---|
| `WORK_ORDER_ID`, `PRODUCT_MODEL_ID` | FKs |
| `INSPECTOR_ID` | FK → `employee.ID` |
| `INSPECTION_DATE` | |
| `STATUS` | `PENDING` / `PASS` / `FAIL` / `REWORK` |
| `PASS_COUNT`, `FAIL_COUNT`, `REWORK_COUNT` | computed |
| `VENDOR_ID` | |

### QCInspectionResult (`qc_inspection_result`)

`INSPECTION_ID`, `CHECKLIST_ITEM_ID`, `CHECK_POINT`, `RESULT` (`PASS` / `FAIL` / `NEEDS_REWORK` / `NA`), `NOTES`.

### NCR (`ncr`)

Non-Conformance Report — auto-created when an inspection result is `FAIL` or `NEEDS_REWORK`.

| Column | Notes |
|---|---|
| `NCR_NUMBER` | unique |
| `INSPECTION_ID`, `WORK_ORDER_ID`, `PRODUCT_MODEL_ID` | FKs |
| `CHECK_POINT`, `SEVERITY` | snapshot |
| `DESCRIPTION`, `ROOT_CAUSE`, `CORRECTIVE_ACTION` | |
| `STATUS` | `OPEN` / `IN_PROGRESS` / `CLOSED` |
| `REPORTED_BY_ID`, `ASSIGNED_TO_ID` | FK → `employee.ID` |
| `OPENED_AT`, `CLOSED_AT` | |
| `VENDOR_ID` | |

## 6.8 Projects & Tasks

### ProjectCategory (`project_category`)

`SECTION`, `NAME` (unique), `DESCRIPTION`.

### SubProjectTemplate (`sub_project_template`)

`CATEGORY_ID`, `NAME`, `DESCRIPTION`, `ESTIMATED_TOTAL_DAYS`.

### Project (`project`)

| Column | Notes |
|---|---|
| `PROJECT_NAME` (VARCHAR 200), `DESCRIPTION` (VARCHAR 2000) | widened by auto-migration |
| `STATUS` | string, vendor-customisable |
| `SUB_PROJECT_TEMPLATE_ID`, `DEPARTMENT_ID`, `CUSTOMER_ID`, `PRODUCT_MODEL_ID` | FKs |
| `QUANTITY`, `TARGET_DATE`, `PRIORITY` (`HIGH`/`MEDIUM`/`LOW`), `SKILLS_REQUIRED` | |
| `VENDOR_ID` | |

### Task (`task`)

`TASK_NAME`, `DESCRIPTION`, `STATUS`, `PRIORITY`, `PROJECT_ID`, `ASSIGNED_TO` (FK → `employee.ID`), `START_TIME`, `END_TIME`, `VENDOR_ID`.

### TaskAssignment (`task_assignment`)

Formal allocation with token-based approval workflow.

| Column | Notes |
|---|---|
| `EMPLOYEE_ID`, `PROJECT_ID` | FKs |
| `TASK_NAME`, `TASK_DETAILS` | |
| `ASSIGNED_DATE`, `DUE_DATE`, `START_TIME`, `END_TIME` | |
| `TASK_STATUS` | string, vendor-customisable |
| `APPROVAL_STATUS` | `PENDING_APPROVAL` / `APPROVED` / `REJECTED` / `EXPIRED` |
| `APPROVAL_TOKEN`, `APPROVAL_REQUESTED_AT`, `APPROVAL_RESOLVED_AT` | |
| `ASSIGNED_BY_ID` | FK → `employee.ID` |

### DailyAllocation (`daily_allocation`)

AI allocator output: which employee gets which task on a given day. `EMPLOYEE_ID`, `ALLOC_DATE`, `SEQUENCE`, `PROJECT_ID`, `TASK_ASSIGNMENT_ID`, `SCORE`, `SCORE_BREAKDOWN`, `REASON`, `VENDOR_ID`.

## 6.9 Attendance & Leave

### BiometricEvent (`biometric_event`)

Raw scan log from devices.

| Column | Notes |
|---|---|
| `DEVICE_ID`, `FINGERPRINT_ID` | |
| `EMPLOYEE_ID` | FK (set once resolved) |
| `EVENT_TIME` | |
| `VERIFY_MODE` | `FP` / `FACE` / `CARD` / `PWD` |
| `RESULT` | `SUCCESS` / `UNKNOWN_USER` / `DUPLICATE` / `ERROR` |
| `RAW_PAYLOAD` | original device JSON |
| `VENDOR_ID` | |

### Attendance (`attendance`)

Daily record (one per employee, date).

| Column | Notes |
|---|---|
| `EMPLOYEE_ID`, `DATE` | composite-unique |
| `CHECK_IN`, `CHECK_OUT` | |
| `STATUS` | `PRESENT` / `LATE` / `ABSENT` / `HALF_DAY` |
| `WORKED_HOURS`, `OVERTIME_HOURS`, `REMARKS` | |

### LeaveRequest (`leave_request`)

| Column | Notes |
|---|---|
| `EMPLOYEE_ID` | FK |
| `LEAVE_TYPE` | `CASUAL` / `SICK` / `EARNED` / `UNPAID` / `LOP` |
| `START_DATE`, `END_DATE`, `DAYS` | |
| `REASON` | |
| `STATUS` | `PENDING_APPROVAL` / `APPROVED` / `REJECTED` / `CANCELLED` / `EXPIRED` |
| `APPROVAL_TOKEN`, `APPROVAL_RESOLVED_AT`, `APPROVED_BY_EMAIL`, `REJECTION_REASON` | |
| `VENDOR_ID` | |

### LeaveBalance (`leave_balance`)

Annual quota tracker. `EMPLOYEE_ID`, `YEAR`, `CASUAL_TOTAL` (12), `CASUAL_USED`, `SICK_TOTAL` (12), `SICK_USED`, `EARNED_TOTAL` (15), `EARNED_USED`.

## 6.10 Payroll & Performance

### PayrollRun (`payroll_run`)

Header per (vendor, year, month).

| Column | Notes |
|---|---|
| `VENDOR_ID`, `PAY_YEAR`, `PAY_MONTH` | |
| `WORKING_DAYS` (default 26) | |
| `STATUS` | `DRAFT` / `FINALIZED` / `PAID` |
| `TOTAL_GROSS`, `TOTAL_DEDUCTIONS`, `TOTAL_NET`, `EMPLOYEE_COUNT` | |
| `GENERATED_BY`, `FINALIZED_AT` | |

### PayrollSlip (`payroll_slip`)

Per-employee breakdown.

| Column | Notes |
|---|---|
| `PAYROLL_RUN_ID`, `EMPLOYEE_ID` | FKs |
| `BASE_SALARY` (snapshot) | |
| `WORKING_DAYS`, `PER_DAY_RATE` | |
| `DAYS_PRESENT`, `DAYS_LATE`, `DAYS_HALF`, `PAID_LEAVE_DAYS`, `UNPAID_LEAVE_DAYS`, `ABSENT_DAYS` | |
| `TASKS_COMPLETED`, `TASK_BONUS_PER_TASK` (100), `TASK_BONUS` | |
| `OT_HOURS`, `OT_PAY` | overtime |
| `EARNED_BASIC`, `LATE_PENALTY`, `OTHER_DEDUCTIONS` | |
| `GROSS_PAY`, `TOTAL_DEDUCTIONS`, `NET_PAY` | |

### PerformanceScore (`performance_score`)

Monthly STAR rating per employee (weighted formula: 25 % attendance + 30 % task completion + 25 % productivity + 20 % consistency).

| Column | Notes |
|---|---|
| `EMPLOYEE_ID`, `PAY_YEAR`, `PAY_MONTH` | |
| Attendance | `WORKING_DAYS`, `DAYS_PRESENT`, `HALF_DAYS` |
| Tasks | `TASKS_ASSIGNED`, `TASKS_COMPLETED`, `TASKS_ON_TIME`, `ESTIMATED_HOURS`, `ACTUAL_HOURS` |
| Stars | `ATTENDANCE_STARS`, `TASK_STARS`, `PRODUCTIVITY_STARS`, `CONSISTENCY_STARS`, `OVERALL_STARS` |
| Recommendations | `RECOMMENDED_FOR_PROMOTION`, `RECOMMENDED_FOR_INCREMENT`, `REWARDED`, `MD_REMARKS` |

## 6.11 System

### Setting (`setting`)

Application key-value config. `KEY` (PK), `VALUE`, `UPDATED_AT`.

### Notification (`notification`)

In-app alerts. `TITLE`, `MESSAGE`, `TYPE` (`INFO`/`WARNING`/`ERROR`), `IS_READ`, `VENDOR_ID`, `CREATED_AT`.

## 6.12 Design Patterns Summary

| Pattern | Where it appears | Why |
|---|---|---|
| **Multi-tenant column** | every customer-facing table | Tenant isolation |
| **Activity / audit table** | `*_activity` for Quotation, SO, PO | Tamper-evident timeline |
| **Status enum as String** | every status field | Flexibility — new statuses added without schema change |
| **Template → instance** | QCChecklistItem → QCInspectionResult; ProcessStage → WorkOrderStageProgress; SubProjectTemplate → Project | Reusable definitions, per-instance state |
| **Workflow FK chain** | Quotation → SalesOrder → Project → WorkOrder → Machine | Traceability from quote to manufactured unit |
| **Token-based public auth** | `Quotation.PUBLIC_TOKEN`, `TaskAssignment.APPROVAL_TOKEN`, `LeaveRequest.APPROVAL_TOKEN` | No portal login required for external participants |

---

Next: [Module 01 — Organization Management](./modules/01-organization.md)
