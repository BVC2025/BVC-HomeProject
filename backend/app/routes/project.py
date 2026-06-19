from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import get_db

from datetime import datetime, date, timedelta

from app.models.models import (
    Customer,
    Employee,
    Project,
    SubProjectTemplate,
    Task,
    TaskAssignment,
    Notification,
    Department,
    ProductModel
)

from app.services.workload_service import pick_least_loaded_employee

from app.services.email_service import (
    send_task_assignment_email,
    send_alert_email
)

from app.services.dept_detection import auto_detect_department_id

from app.services.approval_service import (
    generate_approval_token,
    send_approval_request
)

from app.schemas.project_schema import (
    CustomerCreate,
    CustomerUpdate,
    ProjectCreate,
    ProjectFromProductRequest,
    EnquiryCreate,
    LeadStatusUpdate,
    ContactCreate,
    RequirementCreate,
    RequirementUpdate
)

from app.services.project_from_product_service import (
    create_project_from_product,
    backfill_project_tasks
)

router = APIRouter()


# =========================
# CREATE CUSTOMER
# =========================

def _next_customer_code(db: Session, vendor_id: int) -> str:
    """Auto-generate the next CUST-NNN code."""

    count = db.query(Customer).filter(
        Customer.VENDOR_ID == vendor_id
    ).count()

    return f"CUST-{count + 1:03d}"


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
    sales_rep_name: str = None,
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
        _row("Customer Code", customer.CUSTOMER_CODE)
        + _row("Company Name", customer.CUSTOMER_NAME)
        + _row("Customer Type", customer.CUSTOMER_TYPE)
        + _row("Business Type", customer.BUSINESS_TYPE)
        + _row("Industry", customer.INDUSTRY)
        + _row("Contact Person", customer.CONTACT_PERSON)
        + _row("Designation", customer.DESIGNATION)
        + _row(
            "Existing Vending Customer?",
            "Yes" if customer.EXISTING_MACHINE_USAGE else "No"
        )
        + _row("Current Vendor", customer.CURRENT_VENDOR_NAME)
        + _row("# Branches", customer.NUMBER_OF_BRANCHES)
        + _row(
            "Expected Monthly Orders",
            customer.EXPECTED_MONTHLY_ORDERS
        )
    )

    reach = (
        _row("Phone", customer.PHONE)
        + _row("Alternate Phone", customer.ALTERNATE_PHONE)
        + _row("Email", customer.EMAIL)
        + _row("WhatsApp", customer.WHATSAPP_NUMBER)
        + _row("Website", customer.WEBSITE)
    )

    location = (
        _row("Address", customer.ADDRESS)
        + _row("City", customer.CITY)
        + _row("State", customer.STATE)
        + _row("Pincode", customer.PINCODE)
        + _row("Country", customer.COUNTRY)
        + _row("Billing Address", customer.BILLING_ADDRESS)
        + _row("Shipping Address", customer.SHIPPING_ADDRESS)
        + _row("Google Map", customer.GOOGLE_MAP_LOCATION)
    )

    tax = (
        _row("GST Number", customer.GST_NUMBER)
        + _row("PAN Number", customer.PAN_NUMBER)
    )

    pipeline = (
        _row("Lead Source", customer.LEAD_SOURCE or customer.SOURCE)
        + _row("Lead Status", customer.LEAD_STATUS)
        + _row("Lead Priority", customer.LEAD_PRIORITY)
        + _row("Assigned Salesperson", sales_rep_name)
        + _row("Status", customer.STATUS)
        + _row(
            "Lead Created",
            customer.LEAD_CREATED_DATE.isoformat()
            if customer.LEAD_CREATED_DATE else None
        )
        + _row(
            "Follow-up Date",
            customer.FOLLOW_UP_DATE.isoformat()
            if customer.FOLLOW_UP_DATE else None
        )
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

    notes_section = (
        _row("Requirement Notes", customer.REQUIREMENT_NOTES)
        + _row("Internal Notes", customer.NOTES)
    )

    sections_html = (
        _section("IDENTITY", identity)
        + _section("CONTACT &amp; REACH", reach)
        + _section("LOCATION", location)
        + _section("TAX REGISTRATION", tax)
        + _section("LEAD PIPELINE", pipeline)
        + _section("VENDING MACHINE REQUESTED", order_intake)
        + _section("NOTES", notes_section)
    )

    # Origin badge — distinguishes admin-entry vs self-onboarding
    is_self_serve = (
        (customer.LEAD_SOURCE or "").upper() == "PORTAL_SELF_SERVE"
    )

    origin_label = (
        "via Self-Onboarding Portal"
        if is_self_serve
        else "via CRM"
    )

    intro_line = (
        "A new customer has completed self-registration through the "
        "BVC24 onboarding portal."
        if is_self_serve
        else "A new customer record was just created in the BVC24 system."
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
        {customer.CUSTOMER_NAME}
      </h1>
      <div style="font-size:12px;opacity:0.85;margin-top:4px;">
        {customer.CUSTOMER_CODE}
        {' &middot; ' + customer.INDUSTRY if customer.INDUSTRY else ''}
        &middot; {origin_label}
      </div>
    </div>

    <div style="padding:24px 26px;color:#0f172a;line-height:1.55;">

      <p style="margin:0 0 10px;font-size:14px;color:#0f172a;">
        Dear Sir / Madam,
      </p>

      <p style="margin:0 0 18px;font-size:13px;color:#475569;">
        {intro_line} The full profile captured during their
        registration is detailed below for your review. Please assign
        a sales executive to follow up at your earliest convenience.
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


@router.post("/create-customer")
def create_customer(
    data: CustomerCreate,
    db: Session = Depends(get_db)
):
    """
    Create a customer. Required: CUSTOMER_NAME + PHONE + EMAIL +
    ADDRESS + VENDOR_ID (kept for back-compat). Everything else
    is optional and feeds the customer 360° view.
    """

    try:

        code = (data.CUSTOMER_CODE or "").strip()

        if not code:

            code = _next_customer_code(db, data.VENDOR_ID)

        # Reject duplicate code
        if db.query(Customer).filter(
            Customer.VENDOR_ID == data.VENDOR_ID,
            Customer.CUSTOMER_CODE == code
        ).first():

            raise HTTPException(
                status_code=409,
                detail=f"CUSTOMER_CODE {code} already exists"
            )

        customer = Customer(
            CUSTOMER_CODE=code,
            CUSTOMER_NAME=data.CUSTOMER_NAME,
            CONTACT_PERSON=data.CONTACT_PERSON,
            DESIGNATION=data.DESIGNATION,
            PHONE=data.PHONE,
            ALTERNATE_PHONE=data.ALTERNATE_PHONE,
            EMAIL=data.EMAIL,
            WEBSITE=data.WEBSITE,
            ADDRESS=data.ADDRESS,
            CITY=data.CITY,
            STATE=data.STATE,
            PINCODE=data.PINCODE,
            COUNTRY=data.COUNTRY or "India",
            GST_NUMBER=data.GST_NUMBER,
            PAN_NUMBER=data.PAN_NUMBER,
            INDUSTRY=data.INDUSTRY,
            SOURCE=data.SOURCE,
            STATUS=(data.STATUS or "ACTIVE").upper(),
            NOTES=data.NOTES,
            VENDOR_ID=data.VENDOR_ID,
            # ---- Phase 1: Master + Lead Pipeline fields ----
            CUSTOMER_TYPE=data.CUSTOMER_TYPE,
            BUSINESS_TYPE=data.BUSINESS_TYPE,
            NUMBER_OF_BRANCHES=data.NUMBER_OF_BRANCHES,
            EXPECTED_MONTHLY_ORDERS=data.EXPECTED_MONTHLY_ORDERS,
            EXISTING_MACHINE_USAGE=data.EXISTING_MACHINE_USAGE or 0,
            CURRENT_VENDOR_NAME=data.CURRENT_VENDOR_NAME,
            WHATSAPP_NUMBER=data.WHATSAPP_NUMBER,
            BILLING_ADDRESS=data.BILLING_ADDRESS,
            SHIPPING_ADDRESS=data.SHIPPING_ADDRESS,
            GOOGLE_MAP_LOCATION=data.GOOGLE_MAP_LOCATION,
            LEAD_SOURCE=data.LEAD_SOURCE,
            LEAD_STATUS=(data.LEAD_STATUS or "NEW").upper(),
            LEAD_PRIORITY=(data.LEAD_PRIORITY or "MEDIUM").upper(),
            LEAD_CREATED_DATE=data.LEAD_CREATED_DATE or date.today(),
            ASSIGNED_SALES_ID=data.ASSIGNED_SALES_ID,
            FOLLOW_UP_DATE=data.FOLLOW_UP_DATE,
            REQUIREMENT_NOTES=data.REQUIREMENT_NOTES
        )

        db.add(customer)

        db.commit()

        db.refresh(customer)

        # ---- Order intake: auto-create the requested vending
        # machine as a ProductModel so it appears in the Work Order
        # "Pick a model" dropdown. If a product with the same name
        # already exists for this vendor, reuse it instead of
        # making a duplicate.
        product_info = None

        requested = (data.REQUESTED_MACHINE_NAME or "").strip()

        if requested:

            existing = db.query(ProductModel).filter(
                ProductModel.VENDOR_ID == data.VENDOR_ID,
                ProductModel.MODEL_NAME == requested
            ).first()

            if existing:

                product_info = {
                    "id": existing.ID,
                    "model_code": existing.MODEL_CODE,
                    "model_name": existing.MODEL_NAME,
                    "was_existing": True
                }

            else:

                # Generate a unique MODEL_CODE based on initials of the
                # requested name + an incrementing suffix.
                initials = "".join(
                    w[0].upper()
                    for w in requested.split()
                    if w
                )[:4] or "VM"

                seq = 1

                while db.query(ProductModel).filter(
                    ProductModel.VENDOR_ID == data.VENDOR_ID,
                    ProductModel.MODEL_CODE == f"{initials}-{seq:03d}"
                ).first() is not None:

                    seq += 1

                code = f"{initials}-{seq:03d}"

                new_product = ProductModel(
                    MODEL_NAME=requested,
                    MODEL_CODE=code,
                    CATEGORY=(
                        data.REQUESTED_MACHINE_CATEGORY
                        or "vending"
                    ),
                    DESCRIPTION=(
                        f"Vending machine requested by "
                        f"{customer.CUSTOMER_NAME} "
                        f"({customer.CUSTOMER_CODE}). "
                        f"Auto-created from customer order intake."
                    ),
                    ESTIMATED_BUILD_DAYS=14,
                    STATUS="ACTIVE",
                    VENDOR_ID=data.VENDOR_ID
                )

                db.add(new_product)

                db.flush()

                # Seed default stages so the new product has a
                # working manufacturing flow out of the box. BOM is
                # NOT auto-seeded — the admin defines each line
                # manually via the Production & BOM page so every
                # machine carries its real materials list.
                from app.routes.production import (
                    seed_default_stages_for_product,
                )

                stages_created = seed_default_stages_for_product(
                    db, new_product.ID
                )

                bom_created = 0

                db.commit()

                db.refresh(new_product)

                product_info = {
                    "id": new_product.ID,
                    "model_code": new_product.MODEL_CODE,
                    "model_name": new_product.MODEL_NAME,
                    "was_existing": False,
                    "stages_seeded": stages_created,
                    "bom_seeded": bom_created
                }

        response = {
            "message": "Customer created successfully",
            "customer_id": customer.ID,
            "customer_code": customer.CUSTOMER_CODE,
            "requested_product": product_info,
            "requested_quantity": data.REQUESTED_QUANTITY or 1
        }

        if product_info:

            verb = "linked to existing" if product_info["was_existing"] else "auto-created"

            response["message"] = (
                f"Customer created. Vending machine "
                f"'{product_info['model_name']}' "
                f"({product_info['model_code']}) {verb} in "
                f"Products & BOM."
            )

        # 📲 Notify MD about the new customer
        from app.services.whatsapp_service import notify_md_safe

        notify_md_safe(
            f"✅ *New Customer Registered — BVC24*\n\n"
            f"🏢 *{customer.CUSTOMER_NAME}*\n"
            f"📞 {customer.PHONE}\n"
            + (f"📧 {customer.EMAIL}\n" if customer.EMAIL else "")
            + (f"🏭 Industry: {customer.INDUSTRY}\n" if customer.INDUSTRY else "")
            + (f"📍 {customer.CITY or ''}{', ' + customer.STATE if customer.STATE else ''}\n" if (customer.CITY or customer.STATE) else "")
            + (
                f"\n🤖 Requested: *{product_info['model_name']}* × {data.REQUESTED_QUANTITY or 1}\n"
                if product_info else ""
            )
            + f"\nCode: {customer.CUSTOMER_CODE}"
        )

        # 📧 Send full customer profile to the company inbox (MD)
        # so the MD can see every captured field directly in email.
        # Fire-and-forget — never block the customer-save response on
        # an SMTP / Resend failure.
        try:

            md_target = _md_recipient_email()

            if md_target:

                sales_rep_name = None

                if customer.ASSIGNED_SALES_ID:

                    rep = db.query(Employee).filter(
                        Employee.ID == customer.ASSIGNED_SALES_ID
                    ).first()

                    if rep:

                        sales_rep_name = rep.NAME

                html = _build_customer_profile_email_html(
                    customer,
                    sales_rep_name=sales_rep_name,
                    product_info=product_info,
                    requested_quantity=data.REQUESTED_QUANTITY or 1
                )

                subject = (
                    f"New Customer Registered — {customer.CUSTOMER_NAME} "
                    f"({customer.CUSTOMER_CODE})"
                )

                ok, msg = send_alert_email(subject, html, recipient=md_target)

                response["email_sent"] = ok

                response["email_message"] = msg

                response["email_recipient"] = md_target

        except Exception as email_exc:

            # Never let an email problem block the customer-save flow.
            response["email_sent"] = False

            response["email_message"] = f"email skipped: {email_exc}"

        return response

    except HTTPException:

        raise

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


@router.patch("/customers/{customer_id}")
def update_customer(
    customer_id: int,
    data: CustomerUpdate,
    db: Session = Depends(get_db)
):

    customer = db.query(Customer).filter(
        Customer.ID == customer_id
    ).first()

    if not customer:

        raise HTTPException(
            status_code=404,
            detail="Customer not found"
        )

    for field, value in data.dict(exclude_unset=True).items():

        if field == "STATUS" and value:

            value = value.upper()

        setattr(customer, field, value)

    db.commit()

    db.refresh(customer)

    return {
        "message": "Customer updated",
        "customer_id": customer.ID
    }


# =========================
# CREATE PROJECT
# =========================

@router.post("/create-project")
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

        template = db.query(SubProjectTemplate).filter(
            SubProjectTemplate.ID == data.SUB_PROJECT_TEMPLATE_ID
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

@router.post("/projects/from-product")
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


@router.post("/projects/{project_id}/backfill-tasks")
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


@router.patch("/projects/{project_id}/status")
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

def _serialize_customer(c: Customer, sales_name: str = None) -> dict:
    """Customer row enriched for the frontend list/card. Includes
    Phase 1 lead-pipeline fields + the resolved sales-person name."""

    return {
        "ID": c.ID,
        "CUSTOMER_CODE": c.CUSTOMER_CODE,
        "CUSTOMER_NAME": c.CUSTOMER_NAME,
        "CUSTOMER_TYPE": c.CUSTOMER_TYPE,
        "CONTACT_PERSON": c.CONTACT_PERSON,
        "DESIGNATION": c.DESIGNATION,
        "PHONE": c.PHONE,
        "ALTERNATE_PHONE": c.ALTERNATE_PHONE,
        "WHATSAPP_NUMBER": c.WHATSAPP_NUMBER,
        "EMAIL": c.EMAIL,
        "WEBSITE": c.WEBSITE,
        "ADDRESS": c.ADDRESS,
        "BILLING_ADDRESS": c.BILLING_ADDRESS,
        "SHIPPING_ADDRESS": c.SHIPPING_ADDRESS,
        "GOOGLE_MAP_LOCATION": c.GOOGLE_MAP_LOCATION,
        "CITY": c.CITY,
        "STATE": c.STATE,
        "PINCODE": c.PINCODE,
        "COUNTRY": c.COUNTRY,
        "GST_NUMBER": c.GST_NUMBER,
        "PAN_NUMBER": c.PAN_NUMBER,
        "INDUSTRY": c.INDUSTRY,
        "SOURCE": c.SOURCE,
        "BUSINESS_TYPE": c.BUSINESS_TYPE,
        "NUMBER_OF_BRANCHES": c.NUMBER_OF_BRANCHES,
        "EXPECTED_MONTHLY_ORDERS": c.EXPECTED_MONTHLY_ORDERS,
        "EXISTING_MACHINE_USAGE": bool(c.EXISTING_MACHINE_USAGE),
        "CURRENT_VENDOR_NAME": c.CURRENT_VENDOR_NAME,
        "STATUS": c.STATUS,
        "NOTES": c.NOTES,
        "VENDOR_ID": c.VENDOR_ID,
        # Lead pipeline
        "LEAD_SOURCE": c.LEAD_SOURCE,
        "LEAD_STATUS": c.LEAD_STATUS or "NEW",
        "LEAD_PRIORITY": c.LEAD_PRIORITY or "MEDIUM",
        "LEAD_CREATED_DATE": (
            c.LEAD_CREATED_DATE.isoformat() if c.LEAD_CREATED_DATE else None
        ),
        "ASSIGNED_SALES_ID": c.ASSIGNED_SALES_ID,
        "ASSIGNED_SALES_NAME": sales_name,
        "FOLLOW_UP_DATE": (
            c.FOLLOW_UP_DATE.isoformat() if c.FOLLOW_UP_DATE else None
        ),
        "NEXT_MEETING_DATE": (
            c.NEXT_MEETING_DATE.isoformat() if c.NEXT_MEETING_DATE else None
        ),
        "REQUIREMENT_NOTES": c.REQUIREMENT_NOTES,
        "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None,
        "UPDATED_AT": c.UPDATED_AT.isoformat() if c.UPDATED_AT else None
    }


@router.get("/customers")
def get_customers(
    db: Session = Depends(get_db)
):
    """Return all customers with lead-pipeline info + resolved
    sales-person name (one query, no N+1)."""

    from app.models.models import Employee

    customers = db.query(Customer).order_by(
        Customer.CREATED_AT.desc()
    ).all()

    # Bulk-load assigned salespersons in one query
    sales_ids = {
        c.ASSIGNED_SALES_ID for c in customers
        if c.ASSIGNED_SALES_ID
    }

    sales_names = {}

    if sales_ids:

        for emp in db.query(Employee).filter(
            Employee.ID.in_(sales_ids)
        ).all():

            sales_names[emp.ID] = emp.NAME

    return [
        _serialize_customer(c, sales_names.get(c.ASSIGNED_SALES_ID))
        for c in customers
    ]


# ====================================================================
# Phase 1 — Lead Pipeline endpoints
# ====================================================================

@router.post("/customers/enquiry")
def quick_enquiry(
    data: EnquiryCreate,
    db: Session = Depends(get_db)
):
    """Quick enquiry intake — minimum fields to log a lead. Auto-
    fills lead_status=NEW, generates customer code, returns the
    new ID so the UI can navigate to the full edit form for
    enrichment."""

    code = _next_customer_code(db, data.VENDOR_ID)

    customer = Customer(
        CUSTOMER_CODE=code,
        CUSTOMER_NAME=data.CUSTOMER_NAME,
        PHONE=data.PHONE,
        EMAIL=data.EMAIL or "",
        ADDRESS=(data.CITY or "") + ((", " + data.STATE) if data.STATE else ""),
        CITY=data.CITY,
        STATE=data.STATE,
        INDUSTRY=data.INDUSTRY,
        STATUS="ACTIVE",
        VENDOR_ID=data.VENDOR_ID,
        # Lead-specific defaults
        LEAD_SOURCE=(data.LEAD_SOURCE or "WEBSITE").upper(),
        LEAD_STATUS="NEW",
        LEAD_PRIORITY=(data.LEAD_PRIORITY or "MEDIUM").upper(),
        LEAD_CREATED_DATE=date.today(),
        ASSIGNED_SALES_ID=data.ASSIGNED_SALES_ID,
        REQUIREMENT_NOTES=data.REQUIREMENT_NOTES
    )

    db.add(customer)

    db.commit()

    db.refresh(customer)

    # 📲 Fire-and-forget WhatsApp alert to MD
    from app.services.whatsapp_service import notify_md_safe

    msg = (
        f"🔥 *New Enquiry — BVC24*\n\n"
        f"👤 *{customer.CUSTOMER_NAME}*\n"
        f"📞 {customer.PHONE}\n"
        + (f"📧 {customer.EMAIL}\n" if customer.EMAIL else "")
        + (f"🏢 Industry: {customer.INDUSTRY}\n" if customer.INDUSTRY else "")
        + (f"📍 {customer.CITY or ''}{', ' + customer.STATE if customer.STATE else ''}\n" if (customer.CITY or customer.STATE) else "")
        + f"\n🎯 Priority: *{customer.LEAD_PRIORITY}*\n"
        + (f"\n📝 _{customer.REQUIREMENT_NOTES[:200]}_\n" if customer.REQUIREMENT_NOTES else "")
        + f"\nCode: {customer.CUSTOMER_CODE} · Source: {customer.LEAD_SOURCE}"
    )

    notify_md_safe(msg)

    return {
        "message": f"Enquiry logged for {customer.CUSTOMER_NAME}",
        "customer_id": customer.ID,
        "customer_code": customer.CUSTOMER_CODE,
        "lead_status": customer.LEAD_STATUS
    }


@router.patch("/customers/{customer_id}/lead-status")
def update_lead_status(
    customer_id: int,
    data: LeadStatusUpdate,
    db: Session = Depends(get_db)
):
    """Update a customer's lead pipeline state. Used by the sales
    team to move a lead through NEW → CONTACTED → QUALIFIED →
    QUOTED → NEGOTIATING → WON / LOST."""

    valid_statuses = {
        "NEW", "CONTACTED", "QUALIFIED", "QUOTED",
        "NEGOTIATING", "WON", "LOST"
    }

    valid_priorities = {"HIGH", "MEDIUM", "LOW"}

    customer = db.query(Customer).filter(
        Customer.ID == customer_id
    ).first()

    if not customer:

        raise HTTPException(status_code=404, detail="Customer not found")

    if data.LEAD_STATUS:

        s = data.LEAD_STATUS.upper()

        if s not in valid_statuses:

            raise HTTPException(
                status_code=400,
                detail=f"LEAD_STATUS must be one of {sorted(valid_statuses)}"
            )

        customer.LEAD_STATUS = s

    if data.LEAD_PRIORITY:

        p = data.LEAD_PRIORITY.upper()

        if p not in valid_priorities:

            raise HTTPException(
                status_code=400,
                detail=f"LEAD_PRIORITY must be one of {sorted(valid_priorities)}"
            )

        customer.LEAD_PRIORITY = p

    if data.FOLLOW_UP_DATE:

        customer.FOLLOW_UP_DATE = data.FOLLOW_UP_DATE

    if data.NEXT_MEETING_DATE:

        try:

            customer.NEXT_MEETING_DATE = datetime.fromisoformat(
                data.NEXT_MEETING_DATE
            )

        except Exception:

            raise HTTPException(
                status_code=400,
                detail="NEXT_MEETING_DATE must be ISO 8601"
            )

    if data.ASSIGNED_SALES_ID is not None:

        customer.ASSIGNED_SALES_ID = (
            data.ASSIGNED_SALES_ID or None
        )

    if data.REMARKS is not None:

        # Append remark to notes with a timestamp
        existing = customer.NOTES or ""

        stamp = datetime.now().strftime("%Y-%m-%d %H:%M")

        customer.NOTES = (
            existing + f"\n[{stamp}] {data.REMARKS}"
        ).strip() if existing else f"[{stamp}] {data.REMARKS}"

    db.commit()

    db.refresh(customer)

    return {
        "message": f"Lead updated for {customer.CUSTOMER_NAME}",
        "lead_status": customer.LEAD_STATUS,
        "lead_priority": customer.LEAD_PRIORITY,
        "assigned_sales_id": customer.ASSIGNED_SALES_ID
    }


@router.post("/customers/{customer_id}/contacts")
def add_contact(
    customer_id: int,
    data: ContactCreate,
    db: Session = Depends(get_db)
):
    """Add an additional contact person to a customer."""

    from app.models.models import CustomerContact

    customer = db.query(Customer).filter(
        Customer.ID == customer_id
    ).first()

    if not customer:

        raise HTTPException(status_code=404, detail="Customer not found")

    contact = CustomerContact(
        CUSTOMER_ID=customer_id,
        NAME=data.NAME,
        DESIGNATION=data.DESIGNATION,
        DEPARTMENT=data.DEPARTMENT,
        PHONE=data.PHONE,
        WHATSAPP=data.WHATSAPP,
        EMAIL=data.EMAIL,
        IS_PRIMARY=int(bool(data.IS_PRIMARY)),
        NOTES=data.NOTES
    )

    db.add(contact)

    db.commit()

    db.refresh(contact)

    return {
        "message": "Contact added",
        "contact_id": contact.ID
    }


@router.get("/customers/{customer_id}/contacts")
def list_contacts(
    customer_id: int,
    db: Session = Depends(get_db)
):

    from app.models.models import CustomerContact

    rows = db.query(CustomerContact).filter(
        CustomerContact.CUSTOMER_ID == customer_id
    ).order_by(
        CustomerContact.IS_PRIMARY.desc(),
        CustomerContact.NAME
    ).all()

    return [
        {
            "ID": r.ID,
            "NAME": r.NAME,
            "DESIGNATION": r.DESIGNATION,
            "DEPARTMENT": r.DEPARTMENT,
            "PHONE": r.PHONE,
            "WHATSAPP": r.WHATSAPP,
            "EMAIL": r.EMAIL,
            "IS_PRIMARY": bool(r.IS_PRIMARY),
            "NOTES": r.NOTES
        }
        for r in rows
    ]


@router.delete("/customers/{customer_id}/contacts/{contact_id}")
def delete_contact(
    customer_id: int,
    contact_id: int,
    db: Session = Depends(get_db)
):

    from app.models.models import CustomerContact

    contact = db.query(CustomerContact).filter(
        CustomerContact.ID == contact_id,
        CustomerContact.CUSTOMER_ID == customer_id
    ).first()

    if not contact:

        raise HTTPException(status_code=404, detail="Contact not found")

    db.delete(contact)

    db.commit()

    return {"message": "Contact removed"}


# =========================
# CUSTOMER REQUIREMENTS (Phase 2 — multi-spec)
# =========================

def _serialize_requirement(r) -> dict:

    return {
        "ID": r.ID,
        "CUSTOMER_ID": r.CUSTOMER_ID,
        "MACHINE_CATEGORY": r.MACHINE_CATEGORY,
        "MACHINE_NAME": r.MACHINE_NAME,
        "PRODUCT_MODEL_ID": r.PRODUCT_MODEL_ID,
        "QUANTITY": r.QUANTITY,
        "CAPACITY": r.CAPACITY,
        "TARGET_UNIT_PRICE": r.TARGET_UNIT_PRICE,
        "TARGET_DELIVERY_DATE": (
            r.TARGET_DELIVERY_DATE.isoformat()
            if r.TARGET_DELIVERY_DATE else None
        ),
        "INSTALLATION_SITE": r.INSTALLATION_SITE,
        "PRIORITY": r.PRIORITY,
        "STATUS": r.STATUS,
        "SPECIAL_NOTES": r.SPECIAL_NOTES,
        "CREATED_AT": (
            r.CREATED_AT.isoformat() if r.CREATED_AT else None
        ),
        "UPDATED_AT": (
            r.UPDATED_AT.isoformat() if r.UPDATED_AT else None
        )
    }


@router.post("/customers/{customer_id}/requirements")
def add_requirement(
    customer_id: int,
    data: RequirementCreate,
    db: Session = Depends(get_db)
):
    """Add a new machine requirement to a customer's spec list."""

    from app.models.models import CustomerRequirement

    customer = db.query(Customer).filter(
        Customer.ID == customer_id
    ).first()

    if not customer:

        raise HTTPException(
            status_code=404, detail="Customer not found"
        )

    req = CustomerRequirement(
        CUSTOMER_ID=customer_id,
        MACHINE_CATEGORY=data.MACHINE_CATEGORY,
        MACHINE_NAME=data.MACHINE_NAME,
        PRODUCT_MODEL_ID=data.PRODUCT_MODEL_ID,
        QUANTITY=data.QUANTITY or 1,
        CAPACITY=data.CAPACITY,
        TARGET_UNIT_PRICE=data.TARGET_UNIT_PRICE,
        TARGET_DELIVERY_DATE=data.TARGET_DELIVERY_DATE,
        INSTALLATION_SITE=data.INSTALLATION_SITE,
        PRIORITY=(data.PRIORITY or "MEDIUM").upper(),
        STATUS=(data.STATUS or "DRAFT").upper(),
        SPECIAL_NOTES=data.SPECIAL_NOTES,
        VENDOR_ID=customer.VENDOR_ID or 1
    )

    db.add(req)

    db.commit()

    db.refresh(req)

    return {
        "message": "Requirement added",
        "requirement": _serialize_requirement(req)
    }


@router.get("/customers/{customer_id}/requirements")
def list_requirements(
    customer_id: int,
    db: Session = Depends(get_db)
):

    from app.models.models import CustomerRequirement

    rows = db.query(CustomerRequirement).filter(
        CustomerRequirement.CUSTOMER_ID == customer_id
    ).order_by(
        CustomerRequirement.CREATED_AT.desc()
    ).all()

    return [_serialize_requirement(r) for r in rows]


@router.patch("/customers/{customer_id}/requirements/{req_id}")
def update_requirement(
    customer_id: int,
    req_id: int,
    data: RequirementUpdate,
    db: Session = Depends(get_db)
):

    from app.models.models import CustomerRequirement

    req = db.query(CustomerRequirement).filter(
        CustomerRequirement.ID == req_id,
        CustomerRequirement.CUSTOMER_ID == customer_id
    ).first()

    if not req:

        raise HTTPException(
            status_code=404, detail="Requirement not found"
        )

    payload = data.dict(exclude_unset=True)

    for field, value in payload.items():

        if field in ("PRIORITY", "STATUS") and value:

            value = str(value).upper()

        setattr(req, field, value)

    db.commit()

    db.refresh(req)

    return {
        "message": "Requirement updated",
        "requirement": _serialize_requirement(req)
    }


@router.delete("/customers/{customer_id}/requirements/{req_id}")
def delete_requirement(
    customer_id: int,
    req_id: int,
    db: Session = Depends(get_db)
):

    from app.models.models import CustomerRequirement

    req = db.query(CustomerRequirement).filter(
        CustomerRequirement.ID == req_id,
        CustomerRequirement.CUSTOMER_ID == customer_id
    ).first()

    if not req:

        raise HTTPException(
            status_code=404, detail="Requirement not found"
        )

    db.delete(req)

    db.commit()

    return {"message": "Requirement removed"}


# =========================
# DELETE CUSTOMER
# =========================

@router.delete("/delete-customer/{customer_id}")
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db)
):
    """Delete a customer, cleaning up every FK reference first.

    Strategy (preserves audit / financial history):
      DELETED — pure child rows that have no value without parent
        * customer_contact
        * customer_requirement

      UNLINKED (CUSTOMER_ID -> NULL) — historical / financial rows
        we must keep:
        * project                       (manufacturing history)
        * quotation                     (sales pipeline audit)
        * sales_order                   (financial audit)
        * customer_onboarding_session   (self-onboarding audit)
    """

    from app.models.models import (
        CustomerContact,
        CustomerRequirement,
        Quotation,
        QuotationLine,
        SalesOrder,
        CustomerOnboardingSession
    )

    from sqlalchemy.exc import IntegrityError

    customer = db.query(Customer).filter(
        Customer.ID == customer_id
    ).first()

    if not customer:

        raise HTTPException(
            status_code=404,
            detail="Customer not found"
        )

    customer_name = customer.CUSTOMER_NAME

    customer_code = customer.CUSTOMER_CODE

    try:

        # ---- DELETE pure-child rows ----
        contacts_deleted = db.query(CustomerContact).filter(
            CustomerContact.CUSTOMER_ID == customer_id
        ).delete(synchronize_session=False)

        # Quotation lines may reference this customer's requirements via
        # QuotationLine.REQUIREMENT_ID. Null those out first so the
        # requirement rows can be deleted without tripping the FK.
        req_ids = [
            r[0] for r in db.query(CustomerRequirement.ID).filter(
                CustomerRequirement.CUSTOMER_ID == customer_id
            ).all()
        ]

        qlines_unlinked = 0

        if req_ids:

            qlines_unlinked = db.query(QuotationLine).filter(
                QuotationLine.REQUIREMENT_ID.in_(req_ids)
            ).update(
                {QuotationLine.REQUIREMENT_ID: None},
                synchronize_session=False
            )

        reqs_deleted = db.query(CustomerRequirement).filter(
            CustomerRequirement.CUSTOMER_ID == customer_id
        ).delete(synchronize_session=False)

        # ---- UNLINK reference rows (preserve their audit value) ----
        projects_unlinked = db.query(Project).filter(
            Project.CUSTOMER_ID == customer_id
        ).update(
            {Project.CUSTOMER_ID: None},
            synchronize_session=False
        )

        quotes_unlinked = db.query(Quotation).filter(
            Quotation.CUSTOMER_ID == customer_id
        ).update(
            {Quotation.CUSTOMER_ID: None},
            synchronize_session=False
        )

        sos_unlinked = db.query(SalesOrder).filter(
            SalesOrder.CUSTOMER_ID == customer_id
        ).update(
            {SalesOrder.CUSTOMER_ID: None},
            synchronize_session=False
        )

        onboarding_unlinked = db.query(CustomerOnboardingSession).filter(
            CustomerOnboardingSession.CUSTOMER_ID == customer_id
        ).update(
            {CustomerOnboardingSession.CUSTOMER_ID: None},
            synchronize_session=False
        )

        # Finally delete the customer itself
        db.delete(customer)

        db.commit()

    except IntegrityError as exc:

        db.rollback()

        raise HTTPException(
            status_code=409,
            detail=(
                "Could not delete customer — a database constraint "
                "prevented it. Some new table may reference this "
                "customer that the delete cleanup doesn't yet handle. "
                f"Detail: {str(exc.orig)[:300]}"
            )
        )

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not delete customer: {exc}"
        )

    parts = []

    if contacts_deleted:

        parts.append(
            f"{contacts_deleted} contact{'s' if contacts_deleted != 1 else ''} removed"
        )

    if reqs_deleted:

        parts.append(
            f"{reqs_deleted} requirement{'s' if reqs_deleted != 1 else ''} removed"
        )

    if qlines_unlinked:

        parts.append(f"{qlines_unlinked} quotation line(s) unlinked")

    if projects_unlinked:

        parts.append(f"{projects_unlinked} project(s) unlinked")

    if quotes_unlinked:

        parts.append(f"{quotes_unlinked} quotation(s) unlinked")

    if sos_unlinked:

        parts.append(f"{sos_unlinked} sales order(s) unlinked")

    if onboarding_unlinked:

        parts.append(f"{onboarding_unlinked} onboarding session(s) unlinked")

    summary = " · ".join(parts) if parts else "no related rows"

    return {
        "message": (
            f"Customer '{customer_name}' ({customer_code}) deleted. "
            f"{summary}."
        ),
        "contacts_deleted": contacts_deleted or 0,
        "requirements_deleted": reqs_deleted or 0,
        "quotation_lines_unlinked": qlines_unlinked or 0,
        "projects_unlinked": projects_unlinked or 0,
        "quotations_unlinked": quotes_unlinked or 0,
        "sales_orders_unlinked": sos_unlinked or 0,
        "onboarding_unlinked": onboarding_unlinked or 0
    }


# =========================
# GET PROJECTS
# =========================

@router.get("/projects")
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

@router.post("/projects/auto-assign-missing")
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

@router.delete("/delete-project/{project_id}")
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


@router.post("/projects/wipe-all")
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


# =====================================================================
# Convert a CustomerRequirement → Project (Phase 5 lite — direct
# requirement-to-project conversion, in addition to the quotation
# approval path).
# =====================================================================

@router.post("/customers/{customer_id}/requirements/{req_id}/to-project")
def requirement_to_project(
    customer_id: int,
    req_id: int,
    db: Session = Depends(get_db)
):
    """
    Convert a customer requirement directly into a Project. Uses the
    existing project-from-product service so the new project gets
    auto-seeded stages, tasks, and skill-matched employee assignments.

    Marks the source requirement as ORDERED so it doesn't get picked
    up again by quotation generation.
    """

    from app.models.models import CustomerRequirement

    req = db.query(CustomerRequirement).filter(
        CustomerRequirement.ID == req_id,
        CustomerRequirement.CUSTOMER_ID == customer_id
    ).first()

    if not req:

        raise HTTPException(status_code=404, detail="Requirement not found")

    if not req.PRODUCT_MODEL_ID:

        raise HTTPException(
            status_code=400,
            detail=(
                "Requirement has no linked Product Model. "
                "Edit the requirement and pick a product first "
                "(or create one in Production & BOM)."
            )
        )

    try:

        result = create_project_from_product(
            db,
            customer_id=customer_id,
            product_model_id=req.PRODUCT_MODEL_ID,
            quantity=req.QUANTITY or 1,
            priority=(req.PRIORITY or "MEDIUM").upper(),
            target_date=req.TARGET_DELIVERY_DATE,
            notes=(
                f"From requirement #{req.ID}"
                + (f" — {req.SPECIAL_NOTES}" if req.SPECIAL_NOTES else "")
            ),
            vendor_id=req.VENDOR_ID or 1
        )

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:

        db.rollback()

        raise HTTPException(status_code=500, detail=str(e))

    # Mark the requirement as ORDERED so it doesn't show up in the
    # quotation picker again.
    req.STATUS = "ORDERED"

    db.commit()

    return {
        "message": (
            f"Project created from requirement. "
            f"{result.get('stages_seeded', 0)} stages seeded, "
            f"{result.get('tasks_created', 0)} tasks assigned."
        ),
        "requirement_id": req_id,
        "project": result
    }