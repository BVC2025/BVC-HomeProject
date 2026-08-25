from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.auth.auth_bearer import require

from datetime import datetime, date, timedelta

from app.models.models import (
    Customer,
    Project,
    Task,
    TaskAssignment,
    Notification,
    Department,
)

from app.services.workload_service import pick_least_loaded_employee

from app.services.email_service import (
    send_task_assignment_email,
)

from app.services.dept_detection import auto_detect_department_id

from app.services.approval_service import (
    generate_approval_token,
    send_approval_request
)

from app.schemas.project_schema import (
    ProjectCreate,
    ProjectFromProductRequest
)

from app.services.project_from_product_service import (
    create_project_from_product,
    backfill_project_tasks
)

router = APIRouter()


# =========================
# CREATE CUSTOMER
# =========================

def _md_recipient_email() -> str:
    """The Managing Director / company inbox that receives the
    customer-registration summary. Looks at MD_EMAIL first (most
    specific), then APPROVER_EMAIL, then ADMIN_EMAIL."""

    import os

    for key in ("MD_EMAIL", "APPROVER_EMAIL", "ADMIN_EMAIL"):

        v = (os.getenv(key) or "").strip()

        if v:

            return v

    return ""


def _build_customer_profile_email_html(
    customer: Customer,
    product_info: dict = None,
    requested_quantity: int = 1
) -> str:
    """Build a printable customer-profile HTML body for the MD inbox.
    Mirrors the SO/Quotation email styling — BVC red header, sectioned
    table cards, footer."""

    def _row(label, value):
        """Render one label/value row inside a section card. Empty
        values are skipped so the email stays tight."""

        if value in (None, "", 0):

            return ""

        return (
            f'<tr>'
            f'<td style="padding:5px 8px;color:#64748b;width:42%;'
            f'font-size:12px;">{label}</td>'
            f'<td style="padding:5px 8px;color:#0f172a;'
            f'font-weight:600;font-size:13px;">{value}</td>'
            f'</tr>'
        )

    def _section(title, rows_html):
        """Wrap a set of rows in a coloured card. Returns "" if there
        are no non-empty rows."""

        if not rows_html.strip():

            return ""

        return (
            f'<div style="background:#f8fafc;border-left:3px solid #C8102E;'
            f'padding:10px 14px;border-radius:6px;margin-bottom:14px;">'
            f'<div style="font-size:10px;font-weight:800;color:#8B0B1F;'
            f'letter-spacing:1.5px;margin-bottom:6px;">{title}</div>'
            f'<table style="width:100%;border-collapse:collapse;">'
            f'{rows_html}'
            f'</table>'
            f'</div>'
        )

    identity = (
        _row("Name", customer.NAME)
        + _row("Company Name", customer.COMPANY_NAME)
    )

    reach = (
        _row("Phone", customer.PHONE_NUMBER)
        + _row("Email", customer.EMAIL)
    )

    location = (
        _row("Address", customer.ADDRESS)
    )

    tax = (
        _row("GST Number", customer.GST_NUMBER)
    )

    order_intake = ""

    if product_info:

        verb = (
            "Linked to existing product"
            if product_info.get("was_existing")
            else "Auto-created in Products &amp; BOM"
        )

        order_intake = (
            _row(
                "Requested Machine",
                f"{product_info['model_name']} ({product_info['model_code']})"
            )
            + _row("Quantity", requested_quantity)
            + _row("Status", verb)
        )

    sections_html = (
        _section("IDENTITY", identity)
        + _section("CONTACT &amp; REACH", reach)
        + _section("LOCATION", location)
        + _section("TAX REGISTRATION", tax)
        + _section("VENDING MACHINE REQUESTED", order_intake)
    )

    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:700px;margin:30px auto;background:white;
              border-radius:12px;overflow:hidden;
              box-shadow:0 6px 30px rgba(0,0,0,0.08);">

    <div style="background:linear-gradient(135deg,#C8102E,#8B0B1F);
                color:white;padding:24px 28px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;
                  opacity:0.9;">
        BVC24 &middot; NEW CUSTOMER REGISTRATION ALERT
      </div>
      <h1 style="margin:6px 0 0;font-size:22px;">
        {customer.NAME}
      </h1>
    </div>

    <div style="padding:24px 26px;color:#0f172a;line-height:1.55;">

      <p style="margin:0 0 10px;font-size:14px;color:#0f172a;">
        Dear Sir / Madam,
      </p>

      <p style="margin:0 0 18px;font-size:13px;color:#475569;">
        A new customer record was just created in the BVC24 system.
        The full profile captured is detailed below for your review.
        Please assign a sales executive to follow up at your earliest
        convenience.
      </p>

      {sections_html}

      <p style="margin:22px 0 4px;font-size:12px;color:#94a3b8;">
        This notification was sent automatically by the BVC24 CRM
        module. No reply is required.
      </p>

    </div>

    <div style="background:#f8fafc;padding:14px 28px;font-size:11px;
                color:#94a3b8;text-align:center;">
      Bharath Vending Corporation &middot; Chennai, Tamil Nadu &middot;
      www.bvc24.in
    </div>

  </div>
</body>
</html>
"""


# create_customer()/update_customer() removed — /create-customer and
# PATCH /customers/{id} had zero callers left after Customers.jsx was
# retired in favor of /customer-master (backend/app/routes/customer_master.py).
# The MD WhatsApp/email notification create_customer() used to send has
# been ported into customer_master.py's create_customer_master().


# =========================
# CREATE PROJECT
# =========================

@router.post("/create-project", dependencies=[Depends(require("project.create"))])
def create_project(
    data: ProjectCreate,
    db: Session = Depends(get_db)
):

    if data.CUSTOMER_ID is not None:

        customer_exists = db.query(Customer).filter(
            Customer.ID == data.CUSTOMER_ID
        ).first()

        if not customer_exists:

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Customer ID {data.CUSTOMER_ID} "
                    "does not exist. Create a customer "
                    "first or leave Customer ID blank."
                )
            )

    # Resolve template (if any) and auto-fill defaults
    template = None

    if data.SUB_PROJECT_TEMPLATE_ID is not None:

        template = db.query(Project).filter(
            Project.ID == data.SUB_PROJECT_TEMPLATE_ID
        ).first()

        if not template:

            raise HTTPException(
                status_code=400,
                detail="Sub-project template not found"
            )

    project_name = (
        data.PROJECT_NAME
        or (template.NAME if template else None)
    )

    if not project_name or not str(project_name).strip():

        raise HTTPException(
            status_code=400,
            detail=(
                "PROJECT_NAME is required (or pick a "
                "SUB_PROJECT_TEMPLATE_ID to inherit one)."
            )
        )

    description = (
        data.DESCRIPTION
        or (template.DESCRIPTION if template else None)
    )

    try:

        # Auto-detect department if the admin didn't pick one
        final_department_id = data.DEPARTMENT_ID

        dept_source = "manual"

        if final_department_id is None:

            detected_id, source = auto_detect_department_id(
                db,
                project_name=project_name,
                description=description or "",
                sub_template_id=data.SUB_PROJECT_TEMPLATE_ID
            )

            if detected_id is not None:

                final_department_id = detected_id

                dept_source = source  # "template" or "keywords"

        project = Project(
            PROJECT_NAME=project_name,
            DESCRIPTION=description,
            SUB_PROJECT_TEMPLATE_ID=data.SUB_PROJECT_TEMPLATE_ID,
            DEPARTMENT_ID=final_department_id,
            CUSTOMER_ID=data.CUSTOMER_ID,
            VENDOR_ID=data.VENDOR_ID
        )

        db.add(project)

        db.commit()

        db.refresh(project)

        # ---------------------------------------------------------
        # AUTO-ASSIGN an initial task to the least-loaded employee
        # in the project's department.
        # ---------------------------------------------------------
        emp, prior_count, dept_id = pick_least_loaded_employee(
            db,
            project=project
        )

        auto_task_info = None

        if emp is not None:

            today = date.today()

            now = datetime.utcnow()

            approval_token = generate_approval_token()

            # Resolve department name for the approval email
            dept_name_str = None

            if project.DEPARTMENT_ID:

                d = db.query(Department).filter(
                    Department.ID == project.DEPARTMENT_ID
                ).first()

                dept_name_str = d.NAME if d else None

            auto_task = TaskAssignment(
                EMPLOYEE_ID=emp.ID,
                PROJECT_ID=project.ID,
                TASK_NAME=project.PROJECT_NAME,
                TASK_DETAILS=(
                    project.DESCRIPTION
                    or f"Initial task for project '{project.PROJECT_NAME}'"
                ),
                ASSIGNED_DATE=today,
                DUE_DATE=today + timedelta(days=7),
                TASK_STATUS="PENDING",
                # Approval workflow — task is held until authority approves
                APPROVAL_STATUS="PENDING_APPROVAL",
                APPROVAL_TOKEN=approval_token,
                APPROVAL_REQUESTED_AT=now,
                UPDATED_AT=now
            )

            db.add(auto_task)

            # Notification for the in-app bell (admin sees this)
            notif = Notification(
                TITLE="Task assignment awaiting approval",
                MESSAGE=(
                    f"[Proposal] {emp.NAME} "
                    f"({emp.EMPLOYEE_CODE}) is proposed for "
                    f"the new project '{project.PROJECT_NAME}'. "
                    f"Approval link sent to authority. "
                    f"Expires in 24h."
                ),
                TYPE="INFO",
                IS_READ=0,
                CREATED_AT=now,
                VENDOR_ID=project.VENDOR_ID or 1
            )

            db.add(notif)

            db.commit()

            db.refresh(auto_task)

            # Send the approval request to the authority
            approval_result = send_approval_request(
                employee=emp,
                department_name=dept_name_str,
                task_name=auto_task.TASK_NAME,
                task_details=auto_task.TASK_DETAILS,
                project_name=project.PROJECT_NAME,
                prior_workload=prior_count,
                due_date=auto_task.DUE_DATE,
                approval_token=approval_token,
                db=db,
                department_id=project.DEPARTMENT_ID
            )

            auto_task_info = {
                "TASK_ID": auto_task.TASK_ID,
                "EMPLOYEE_ID": emp.ID,
                "EMPLOYEE_NAME": emp.NAME,
                "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
                "PRIOR_ACTIVE_TASKS": prior_count,
                "DEPARTMENT_ID": dept_id,
                "DEPARTMENT_SOURCE": dept_source,
                "APPROVAL_STATUS": "PENDING_APPROVAL",
                "APPROVAL_AUTHORITY_NAME": approval_result["authority_name"],
                "APPROVAL_AUTHORITY_EMAIL": approval_result["authority_email"],
                "APPROVAL_AUTHORITY_SOURCE": approval_result["authority_source"],
                "APPROVAL_EMAIL_SENT": approval_result["email_sent"],
                "APPROVAL_EMAIL_MESSAGE": approval_result["email_message"],
                "APPROVAL_SMS_SENT": approval_result["sms_sent"],
                "APPROVAL_SMS_MESSAGE": approval_result["sms_message"],
                "APPROVE_URL": approval_result["approve_url"],
                "REJECT_URL": approval_result["reject_url"]
            }

        return {
            "message": "Project created successfully",
            "project_id": project.ID,
            "auto_task": auto_task_info,
            "auto_assigned": auto_task_info is not None
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# CREATE PROJECT FROM PRODUCT (the new BVC24 way)
# =========================

@router.post("/projects/from-product", dependencies=[Depends(require("project.create"))])
def create_project_from_product_route(
    data: ProjectFromProductRequest,
    db: Session = Depends(get_db)
):
    """
    Single endpoint that captures the entire new BVC24 workflow:

        Customer + Product  →  Project + WorkOrder
                            →  Tasks (one per process stage)
                            →  Auto-assigned by skill match
                            →  Emails fired
                            →  Awaiting employee acceptance

    Replaces the old "create blank project" form. A project is
    now always an instance of a Product being built for a
    Customer — no more orphan projects.
    """

    try:

        result = create_project_from_product(
            db,
            customer_id=data.CUSTOMER_ID,
            product_model_id=data.PRODUCT_MODEL_ID,
            quantity=data.QUANTITY,
            priority=data.PRIORITY or "MEDIUM",
            target_date=data.TARGET_DATE,
            notes=data.NOTES,
            vendor_id=data.VENDOR_ID
        )

        return result

    except ValueError as e:

        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:

        db.rollback()

        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/backfill-tasks", dependencies=[Depends(require("project.update"))])
def backfill_project_tasks_route(
    project_id: int,
    db: Session = Depends(get_db)
):
    """
    Rescue a product-driven project that was created before the
    stage auto-seeding fix (or before the product had any stages).
    Seeds the default stages on the product if needed, creates
    the missing WorkOrderStageProgress rows, generates skill-matched
    TaskAssignments for any stage that doesn't already have one,
    and emails the assigned employees.

    Idempotent — safe to re-run; existing tasks aren't duplicated.
    """

    try:

        return backfill_project_tasks(db, project_id)

    except ValueError as e:

        raise HTTPException(status_code=404, detail=str(e))

    except Exception as e:

        db.rollback()

        raise HTTPException(status_code=500, detail=str(e))


VALID_PROJECT_STATUSES = {
    "ACTIVE",
    "IN_PROGRESS",
    "PENDING",
    "ON_HOLD",
    "COMPLETED",
    "DONE",
    "CANCELLED"
}


class ProjectStatusUpdate(BaseModel):

    STATUS: str


@router.patch("/projects/{project_id}/status", dependencies=[Depends(require("project.update"))])
def update_project_status(
    project_id: int,
    data: ProjectStatusUpdate,
    db: Session = Depends(get_db)
):
    """Mark a project as COMPLETED (or any other valid status).
    Used by the 'Mark Done' button on the Projects page card and
    drawer — also lets you reopen a finished project by setting
    STATUS back to ACTIVE."""

    new_status = (data.STATUS or "").upper().strip()

    if new_status not in VALID_PROJECT_STATUSES:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid status. Must be one of: "
                f"{', '.join(sorted(VALID_PROJECT_STATUSES))}"
            )
        )

    project = db.query(Project).filter(Project.ID == project_id).first()

    if not project:

        raise HTTPException(status_code=404, detail="Project not found")

    prev = project.STATUS

    project.STATUS = new_status

    db.commit()

    return {
        "message": (
            f"Project '{project.PROJECT_NAME}' moved {prev} → {new_status}."
        ),
        "project_id": project.ID,
        "previous_status": prev,
        "new_status": new_status
    }


# =========================
# GET CUSTOMERS
# =========================

def _serialize_customer(c: Customer) -> dict:
    return {
        "ID": c.ID,
        "NAME": c.NAME,
        "COMPANY_NAME": c.COMPANY_NAME,
        "PHONE_NUMBER": c.PHONE_NUMBER,
        "EMAIL": c.EMAIL,
        "ADDRESS": c.ADDRESS,
        "GST_NUMBER": c.GST_NUMBER,
        "VENDOR_ID": c.VENDOR_ID,
        "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None,
        "UPDATED_AT": c.UPDATED_AT.isoformat() if c.UPDATED_AT else None,
    }


@router.get("/customers", dependencies=[Depends(require("customer.view"))])
def get_customers(
    db: Session = Depends(get_db)
):
    """Return all customers."""

    customers = db.query(Customer).order_by(
        Customer.CREATED_AT.desc()
    ).all()

    return [_serialize_customer(c) for c in customers]


# delete_customer() removed — DELETE /delete-customer/{id} had zero
# callers left after Customers.jsx was retired in favor of
# /customer-master. Its safe FK-unlink logic (Quotation/SalesOrder/
# CustomerProject/CustomerOnboardingSession -> CUSTOMER_ID = NULL
# before delete) has been ported into customer_master.py's
# delete_customer_master().


# =========================
# GET PROJECTS
# =========================

@router.get("/projects", dependencies=[Depends(require("project.view"))])
def get_projects(
    db: Session = Depends(get_db)
):
    """List every project enriched with Work Order info.

    Adds three derived fields per project so the UI can split
    Active vs Done sections without separate API calls:
      - wo_count         : total work orders linked to this project
      - wo_done_count    : how many of those are STATUS='DONE'
      - effective_status : "DONE" if project itself is marked
                           COMPLETED/DONE OR any of its WOs is DONE.
                           Otherwise falls back to project.STATUS.

    The "any WO done -> project done" rule matches the user's flow:
    in Production & BOM, marking a WO DONE makes the linked project
    automatically appear in the Done section of the Projects page.
    No manual project-level toggle needed.
    """

    from app.models.models import WorkOrder

    projects = db.query(Project).all()

    if not projects:

        return []

    proj_ids = [p.ID for p in projects]

    # Aggregate WO counts per project in a single grouped query
    wo_rows = (
        db.query(
            WorkOrder.PROJECT_ID,
            WorkOrder.STATUS,
        )
        .filter(WorkOrder.PROJECT_ID.in_(proj_ids))
        .all()
    )

    total_by_proj: dict = {}

    done_by_proj: dict = {}

    for proj_id, status in wo_rows:

        total_by_proj[proj_id] = total_by_proj.get(proj_id, 0) + 1

        if (status or "").upper() == "DONE":

            done_by_proj[proj_id] = done_by_proj.get(proj_id, 0) + 1

    DONE_PROJECT_STATUSES = {"COMPLETED", "DONE"}

    out = []

    for p in projects:

        wo_count = total_by_proj.get(p.ID, 0)

        wo_done_count = done_by_proj.get(p.ID, 0)

        is_done = (
            (p.STATUS or "").upper() in DONE_PROJECT_STATUSES
            or wo_done_count > 0
        )

        # SQLAlchemy models can be serialized via __dict__ but that
        # includes internal _sa fields. Use the model's columns
        # explicitly for a clean JSON shape, then layer derived
        # fields on top.
        row = {
            c.name: getattr(p, c.name) for c in Project.__table__.columns
        }

        row["wo_count"] = wo_count

        row["wo_done_count"] = wo_done_count

        row["effective_status"] = "DONE" if is_done else (
            (p.STATUS or "PENDING").upper()
        )

        out.append(row)

    return out


# =========================
# BACKFILL — AUTO-ASSIGN MISSING TASKS
# =========================

@router.post("/projects/auto-assign-missing", dependencies=[Depends(require("project.update"))])
def auto_assign_missing(
    db: Session = Depends(get_db)
):
    """
    Finds every project that currently has ZERO task_assignment
    rows. For each, picks the least-loaded employee (from the
    project's department, or globally) and creates one initial
    task + a notification.

    Useful for projects that were created before auto-assign
    was wired in.
    """

    projects = db.query(Project).all()

    if not projects:

        return {
            "message": "No projects found.",
            "projects_processed": 0,
            "tasks_created": 0,
            "skipped": 0,
            "details": []
        }

    today = date.today()

    created_count = 0

    skipped_count = 0

    details = []

    for project in projects:

        # Skip if any task_assignment already exists for this project
        existing = db.query(TaskAssignment).filter(
            TaskAssignment.PROJECT_ID == project.ID
        ).first()

        if existing:

            skipped_count += 1

            details.append({
                "PROJECT_ID": project.ID,
                "PROJECT_NAME": project.PROJECT_NAME,
                "status": "skipped",
                "reason": "Already has tasks"
            })

            continue

        # Auto-detect department if the project doesn't have one
        if project.DEPARTMENT_ID is None:

            detected_id, _ = auto_detect_department_id(
                db,
                project_name=project.PROJECT_NAME or "",
                description=project.DESCRIPTION or "",
                sub_template_id=project.SUB_PROJECT_TEMPLATE_ID
            )

            if detected_id is not None:

                project.DEPARTMENT_ID = detected_id

                db.commit()

        emp, prior_count, dept_id = pick_least_loaded_employee(
            db,
            project=project
        )

        if emp is None:

            skipped_count += 1

            details.append({
                "PROJECT_ID": project.ID,
                "PROJECT_NAME": project.PROJECT_NAME,
                "status": "skipped",
                "reason": "No active employees available"
            })

            continue

        task = TaskAssignment(
            EMPLOYEE_ID=emp.ID,
            PROJECT_ID=project.ID,
            TASK_NAME=project.PROJECT_NAME,
            TASK_DETAILS=(
                project.DESCRIPTION
                or f"Initial task for project '{project.PROJECT_NAME}'"
            ),
            ASSIGNED_DATE=today,
            DUE_DATE=today + timedelta(days=7),
            TASK_STATUS="PENDING",
            UPDATED_AT=datetime.utcnow()
        )

        db.add(task)

        notif = Notification(
            TITLE="New project auto-assigned",
            MESSAGE=(
                f"[Auto-assigned] {emp.NAME} "
                f"({emp.EMPLOYEE_CODE}) has been "
                f"assigned the project "
                f"'{project.PROJECT_NAME}'. "
                f"Prior workload: {prior_count} active task(s)."
            ),
            TYPE="INFO",
            IS_READ=0,
            CREATED_AT=datetime.utcnow(),
            VENDOR_ID=project.VENDOR_ID or 1
        )

        db.add(notif)

        created_count += 1

        # Send email AFTER the row is in the DB so we don't
        # lose the task if SMTP is slow / fails.
        details.append({
            "PROJECT_ID": project.ID,
            "PROJECT_NAME": project.PROJECT_NAME,
            "status": "assigned",
            "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
            "EMPLOYEE_NAME": emp.NAME,
            "EMPLOYEE_EMAIL": emp.EMAIL,
            "prior_workload": prior_count,
            "_pending_email": True,
            "_email_emp": emp,
            "_email_task_name": task.TASK_NAME,
            "_email_task_details": task.TASK_DETAILS,
            "_email_due_date": task.DUE_DATE
        })

    db.commit()

    # Now fire all emails in one pass (outside the per-row loop
    # so SMTP latency doesn't slow the DB commits)
    emails_sent = 0

    for d in details:

        if not d.get("_pending_email"):

            continue

        ok, msg = send_task_assignment_email(
            employee=d["_email_emp"],
            task_name=d["_email_task_name"],
            task_details=d["_email_task_details"],
            project_name=d["PROJECT_NAME"],
            due_date=d["_email_due_date"],
            is_auto=True
        )

        d["EMAIL_SENT"] = ok

        d["EMAIL_MESSAGE"] = msg

        if ok:

            emails_sent += 1

        # Clean up the private keys so they don't leak in JSON
        for k in [
            "_pending_email",
            "_email_emp",
            "_email_task_name",
            "_email_task_details",
            "_email_due_date"
        ]:

            d.pop(k, None)

    return {
        "message": (
            f"Backfill complete. {created_count} project(s) "
            f"auto-assigned, {skipped_count} skipped. "
            f"{emails_sent} email(s) sent."
        ),
        "emails_sent": emails_sent,
        "projects_processed": len(projects),
        "tasks_created": created_count,
        "skipped": skipped_count,
        "details": details
    }


# =========================
# DELETE PROJECT
# =========================

@router.delete("/delete-project/{project_id}", dependencies=[Depends(require("project.delete"))])
def delete_project(
    project_id: int,
    db: Session = Depends(get_db)
):
    """
    Removes a project. Every child row that references it via FK
    gets its project pointer set to NULL rather than being deleted,
    so the work / financial history is preserved:

      - TaskAssignment, legacy Task        (.PROJECT_ID)
      - WorkOrder                          (.PROJECT_ID, keeps WO #, BOM, QC chain)
      - DailyAllocation                    (.PROJECT_ID, keeps attendance audit)
      - PurchaseOrder                      (.LINKED_PROJECT_ID, financial)
      - SalesOrderLine                     (.SPAWNED_PROJECT_ID, contract audit)
    """

    from app.models.models import (
        WorkOrder,
        DailyAllocation,
        PurchaseOrder,
        SalesOrderLine
    )

    from sqlalchemy.exc import IntegrityError

    project = db.query(Project).filter(
        Project.ID == project_id
    ).first()

    if not project:

        raise HTTPException(
            status_code=404,
            detail="Project not found"
        )

    project_name = project.PROJECT_NAME

    try:

        unlinked_ta = db.query(TaskAssignment).filter(
            TaskAssignment.PROJECT_ID == project_id
        ).update(
            {TaskAssignment.PROJECT_ID: None},
            synchronize_session=False
        )

        unlinked_t = db.query(Task).filter(
            Task.PROJECT_ID == project_id
        ).update(
            {Task.PROJECT_ID: None},
            synchronize_session=False
        )

        unlinked_wo = db.query(WorkOrder).filter(
            WorkOrder.PROJECT_ID == project_id
        ).update(
            {WorkOrder.PROJECT_ID: None},
            synchronize_session=False
        )

        unlinked_da = db.query(DailyAllocation).filter(
            DailyAllocation.PROJECT_ID == project_id
        ).update(
            {DailyAllocation.PROJECT_ID: None},
            synchronize_session=False
        )

        unlinked_po = db.query(PurchaseOrder).filter(
            PurchaseOrder.LINKED_PROJECT_ID == project_id
        ).update(
            {PurchaseOrder.LINKED_PROJECT_ID: None},
            synchronize_session=False
        )

        unlinked_sol = db.query(SalesOrderLine).filter(
            SalesOrderLine.SPAWNED_PROJECT_ID == project_id
        ).update(
            {SalesOrderLine.SPAWNED_PROJECT_ID: None},
            synchronize_session=False
        )

        db.delete(project)

        db.commit()

    except IntegrityError as exc:

        db.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "Could not delete project — a database constraint "
                "prevented it. A new table may reference this project "
                "that the cleanup doesn't yet handle. "
                f"Detail: {str(exc.orig)[:300]}"
            )
        )

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not delete project: {exc}"
        )

    parts = []

    if unlinked_ta or unlinked_t:

        parts.append(f"{(unlinked_ta or 0) + (unlinked_t or 0)} task(s) unlinked")

    if unlinked_wo:

        parts.append(f"{unlinked_wo} work order(s) unlinked")

    if unlinked_da:

        parts.append(f"{unlinked_da} daily allocation(s) unlinked")

    if unlinked_po:

        parts.append(f"{unlinked_po} purchase order(s) unlinked")

    if unlinked_sol:

        parts.append(f"{unlinked_sol} sales order line(s) unlinked")

    summary = " · ".join(parts) if parts else "no related rows"

    return {
        "message": f"Project '{project_name}' deleted. {summary}.",
        "project_id": project_id,
        "tasks_unlinked": (unlinked_ta or 0) + (unlinked_t or 0),
        "work_orders_unlinked": unlinked_wo or 0,
        "daily_allocations_unlinked": unlinked_da or 0,
        "purchase_orders_unlinked": unlinked_po or 0,
        "sales_order_lines_unlinked": unlinked_sol or 0
    }


@router.post("/projects/wipe-all", dependencies=[Depends(require("project.delete"))])
def wipe_all_projects(
    db: Session = Depends(get_db)
):
    """
    Nuclear option — deletes EVERY project and all child rows
    (tasks, task_assignments, daily_allocations, work_orders,
    wo_stage_progress, qc_inspections, ncrs that reference work
    orders, notifications, project-linked rows).

    Customers / Employees / Suppliers / Quotations / Inventory
    are preserved. Purchase Orders keep their LINKED_PROJECT_ID
    nulled out (the POs themselves aren't deleted — those are
    procurement history).

    Uses MySQL SET FOREIGN_KEY_CHECKS=0 like the employee wipe
    so FK ordering doesn't block. Idempotent — safe to re-run.
    """

    summary = {}

    try:

        db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

        # 1. Null-out outbound references from rows we want to keep
        for sql, key in [
            (
                "UPDATE purchase_order SET LINKED_PROJECT_ID = NULL "
                "WHERE LINKED_PROJECT_ID IS NOT NULL",
                "purchase_order.LINKED_PROJECT_ID"
            ),
        ]:

            try:

                r = db.execute(text(sql))

                summary[key] = r.rowcount

            except Exception as exc:

                summary[key] = f"skipped: {type(exc).__name__}"

        # 2. Child tables to fully wipe — order doesn't matter while
        # FK checks are off, but staying child-first keeps the intent
        # clear if FK checks were re-enabled mid-flight.
        child_tables = [
            # Notifications referencing tasks/projects
            "notification",
            # Daily allocations (depend on task_assignment + project)
            "daily_allocation",
            # Task assignments (the per-stage rows employees accept)
            "task_assignment",
            # Tasks (referenced by daily_allocation, task_assignment)
            "task",
            # Work order child rows
            "wo_stage_progress",
            "qc_inspection",
            "ncr",
            "approval_token",
            # Work orders (parent of the above)
            "work_order",
            # Projects (last)
            "project",
        ]

        for t in child_tables:

            try:

                r = db.execute(text(f"DELETE FROM {t}"))

                summary[t] = r.rowcount

            except Exception as exc:

                summary[t] = f"skipped: {type(exc).__name__}"

        db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

        db.commit()

    except Exception as exc:

        db.rollback()

        try:

            db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

            db.commit()

        except Exception:

            pass

        raise HTTPException(
            status_code=500,
            detail=f"Project wipe failed: {exc}"
        )

    return {
        "message": "All projects + child rows deleted",
        **summary
    }