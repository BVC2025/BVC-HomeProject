"""
Product-driven Project orchestration.

This is the heart of the new BVC24 workflow:

    Product → Project → Customer → Tasks → Skill-based Assignment
            → Email Notification → Employee Acceptance → Dashboard

When a customer requests a vending machine, we don't create a
"blank" project anymore. Instead, we instantiate the product
itself: the project inherits the product's BOM, process stages,
and category. Each manufacturing stage becomes a task. Each task
gets auto-assigned to the best-matching employee by skill +
workload. Each assigned employee gets a notification email and
the task waits in PENDING_APPROVAL until they accept it from
their dashboard.

Public entry point: `create_project_from_product()`.
"""

from datetime import date, datetime, timedelta
from math import ceil
from typing import Optional, List, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import (
    Project,
    Customer,
    Employee,
    ProductModel,
    BOMItem,
    ProcessStage,
    WorkOrder,
    WorkOrderStageProgress,
    TaskAssignment,
    Department,
    Role
)


# Role names that should NEVER receive shop-floor task assignments.
# These are the system/management roles — admins manage the ERP,
# they don't execute manufacturing stages. Keep lowercase for the
# case-insensitive compare; cover the common name variants the
# different seed scripts have introduced over time.
ADMIN_ROLE_NAMES = {
    "super_admin",
    "admin",
    "system_administrator",
    "manager",
}


# Map each manufacturing stage type → the comma-separated skill
# keywords we'll look for on an employee. Drives auto-assignment.
STAGE_TYPE_SKILLS = {
    "DESIGN":      "product design,design,solidworks",
    "MECHANICAL":  "mechanical,solidworks,thermal design,product design",
    "ELECTRICAL":  "electrical schematic,electrical,iot,embedded c,sensor integration",
    "WIRING":      "electrical wiring,wiring,harness routing",
    "FABRICATION": "sheet metal,fabrication,welding,assembly",
    "ASSEMBLY":    "assembly,mounting,sheet metal",
    "TESTING":     "testing,quality check,inspection",
    "QC":          "quality check,inspection,rca,documentation",
    "PACKAGING":   "packaging,dispatch,documentation",
    "OTHER":       ""
}


ACTIVE_TASK_STATUSES = ("PENDING", "IN_PROGRESS", "ON_HOLD")


# ----------------------------------------------------------------
# Skill-based employee picker
# ----------------------------------------------------------------

def _split_skills(raw: Optional[str]) -> set:

    if not raw:

        return set()

    return {
        s.strip().lower()
        for s in raw.split(",")
        if s.strip()
    }


def _employee_workload(db: Session, employee_id: str) -> int:

    return db.query(func.count(TaskAssignment.TASK_ID)).filter(
        TaskAssignment.EMPLOYEE_ID == employee_id,
        TaskAssignment.TASK_STATUS.in_(ACTIVE_TASK_STATUSES),
        TaskAssignment.APPROVAL_STATUS.in_(["APPROVED", "PENDING"])
    ).scalar() or 0


def _employees_with_active_project(db: Session, vendor_id: int) -> set:
    """Set of employee IDs that already own at least one active
    project assignment. Used to enforce fair distribution: new
    projects go to FREE employees first, only repeating when
    everyone is busy.

    'Active' = TaskAssignment with TASK_STATUS in
    (PENDING / IN_PROGRESS / ON_HOLD) AND PROJECT_ID not null AND
    the project itself is still ACTIVE (not COMPLETED/CANCELLED)."""

    rows = (
        db.query(TaskAssignment.EMPLOYEE_ID)
        .join(Project, TaskAssignment.PROJECT_ID == Project.ID)
        .filter(
            TaskAssignment.EMPLOYEE_ID.isnot(None),
            TaskAssignment.PROJECT_ID.isnot(None),
            TaskAssignment.TASK_STATUS.in_(ACTIVE_TASK_STATUSES),
            Project.VENDOR_ID == vendor_id,
            Project.STATUS.notin_(["COMPLETED", "CANCELLED", "DONE"])
        )
        .distinct()
        .all()
    )

    return {emp_id for (emp_id,) in rows if emp_id}


def _lifetime_project_count_per_employee(db: Session) -> dict:
    """Returns {employee_id: number_of_distinct_projects_ever_owned}.
    Counts DISTINCT PROJECT_IDs across all task assignments,
    regardless of task status. Used for true fair-distribution —
    Hemnath who has owned 2 projects sinks below Saranya who has
    owned 0, even if Hemnath's prior tasks all completed."""

    rows = (
        db.query(
            TaskAssignment.EMPLOYEE_ID,
            func.count(func.distinct(TaskAssignment.PROJECT_ID))
                .label("project_count")
        )
        .filter(
            TaskAssignment.EMPLOYEE_ID.isnot(None),
            TaskAssignment.PROJECT_ID.isnot(None)
        )
        .group_by(TaskAssignment.EMPLOYEE_ID)
        .all()
    )

    return {emp_id: cnt for emp_id, cnt in rows}


def _is_admin_role(role: Optional[Role]) -> bool:
    """True if this role is a management/admin role that should NOT
    receive shop-floor task assignments. Case-insensitive."""

    if role is None or not role.ROLE_NAME:

        return False

    return role.ROLE_NAME.strip().lower() in ADMIN_ROLE_NAMES


def find_fairest_owner(
    db: Session,
    required_skills: str,
    vendor_id: int,
    department_id: Optional[int] = None
) -> tuple:
    """Pick the project owner using TRUE fair-distribution.

    Sort key: (lifetime_project_count ASC, skill_match DESC).

    This is stronger than 'busy-vs-free' because Hemnath who owned
    2 projects last week stays BELOW Saranya who owned 0, even if
    Hemnath's old tasks are all completed. Skill match is the
    tiebreaker among people with the same project count — so among
    the unloaded workers, the best-skill one still wins.

    vendor_id is used as a soft filter: we try that vendor's
    workers first, then expand to all active workers if the pool
    is empty (handles BVC's split-tenant data where some employees
    sit on vendor_id=1 and others on vendor_id=4).

    Returns (employee, decision_log) — decision_log is a dict
    explaining why this person was picked. None if no candidates.
    """

    # ---- 1. Build candidate pool ----
    # Start with vendor-scoped active workers, drop admins.
    q = (
        db.query(Employee, Role)
        .outerjoin(Role, Employee.ROLE_ID == Role.ID)
        .filter(Employee.STATUS == "ACTIVE")
    )

    # Try vendor scope first
    vendor_rows = q.filter(Employee.VENDOR_ID == vendor_id).all()

    candidates = [
        emp for emp, role in vendor_rows if not _is_admin_role(role)
    ]

    pool_source = f"vendor_id={vendor_id}"

    # Soft fallback: if nothing in this vendor, expand to ALL
    # active workers (single-tenant BVC quirk).
    if not candidates:

        all_rows = q.all()

        candidates = [
            emp for emp, role in all_rows if not _is_admin_role(role)
        ]

        pool_source = "all-vendors fallback"

    if not candidates:

        return None, {
            "picked": None,
            "reason": "No active non-admin workers found",
            "pool_source": pool_source,
            "pool_size": 0
        }

    # ---- 2. Compute lifetime project counts for every candidate ----
    proj_counts = _lifetime_project_count_per_employee(db)

    # ---- 3. Compute skill match per candidate ----
    required = _split_skills(required_skills)

    def _skill_overlap(emp):

        if not required:

            return 0.5  # neutral when no skill keywords given

        emp_skills = _split_skills(emp.SKILLS)

        return len(required & emp_skills) / len(required)

    # ---- 4. Sort: fewest projects first, best skill as tiebreaker ----
    # Optional department preference baked in as a 3rd tiebreaker
    # (within same project count + skill, prefer same-dept worker).
    def _sort_key(emp):

        cnt = proj_counts.get(emp.ID, 0)

        skill = _skill_overlap(emp)

        same_dept = (
            1 if department_id is not None
            and emp.DEPARTMENT_ID == department_id
            else 0
        )

        # Negative skill so HIGHER skill ranks first; negative
        # same_dept so True ranks first.
        return (cnt, -skill, -same_dept)

    candidates.sort(key=_sort_key)

    winner = candidates[0]

    winner_skill = _skill_overlap(winner)

    winner_count = proj_counts.get(winner.ID, 0)

    # ---- 5. Build a decision log so the caller can show WHY ----
    # Show top 3 candidates so we can see the ranking clearly.
    top3 = [
        {
            "employee_code": e.EMPLOYEE_CODE,
            "name": e.NAME,
            "lifetime_project_count": proj_counts.get(e.ID, 0),
            "skill_match": round(_skill_overlap(e), 3),
            "same_dept": (
                department_id is not None
                and e.DEPARTMENT_ID == department_id
            )
        }
        for e in candidates[:3]
    ]

    log = {
        "picked": {
            "employee_id": winner.ID,
            "employee_code": winner.EMPLOYEE_CODE,
            "name": winner.NAME,
            "lifetime_project_count": winner_count,
            "skill_match": round(winner_skill, 3)
        },
        "reason": (
            f"{winner.NAME} ({winner.EMPLOYEE_CODE}) — "
            f"{winner_count} prior project(s), "
            f"skill match {round(winner_skill * 100)}%"
        ),
        "pool_source": pool_source,
        "pool_size": len(candidates),
        "top_candidates": top3
    }

    return winner, log


def find_best_employee(
    db: Session,
    required_skills: str,
    vendor_id: int,
    department_id: Optional[int] = None,
    exclude_employee_ids: Optional[set] = None
):
    """Pick the active employee with the best (skill_overlap × inverse_workload)
    score for the given skill keywords. Returns (employee, score) or (None, 0).

    Admin / SUPER_ADMIN / manager roles are filtered out entirely —
    those users administer the ERP and should never appear as the
    assignee of a manufacturing task."""

    # Left-outer join to Role so employees without a role row don't
    # vanish from the pool — only employees WITH an admin role do.
    q = (
        db.query(Employee, Role)
        .outerjoin(Role, Employee.ROLE_ID == Role.ID)
        .filter(
            Employee.VENDOR_ID == vendor_id,
            Employee.STATUS == "ACTIVE"
        )
    )

    # Department-scope first; fall back to all if nobody matches
    if department_id is not None:

        scoped = q.filter(Employee.DEPARTMENT_ID == department_id).all()

        rows = scoped if scoped else q.all()

    else:

        rows = q.all()

    # Drop admins from the pool — they manage, they don't execute.
    candidates = [emp for emp, role in rows if not _is_admin_role(role)]

    if exclude_employee_ids:

        candidates = [
            e for e in candidates
            if e.ID not in exclude_employee_ids
        ]

    required = _split_skills(required_skills)

    best = None

    best_score = -1.0

    for emp in candidates:

        emp_skills = _split_skills(emp.SKILLS)

        if required:

            overlap = (
                len(required & emp_skills) / len(required)
                if required else 0
            )

        else:

            # No required skills → everyone scores neutral on skill
            overlap = 0.5

        workload = _employee_workload(db, emp.ID)

        workload_score = max(0, 1 - workload / 8.0)

        score = 0.65 * overlap + 0.35 * workload_score

        if score > best_score:

            best_score = score

            best = emp

    return best, round(best_score, 3)


# ----------------------------------------------------------------
# Main orchestrator
# ----------------------------------------------------------------

def create_project_from_product(
    db: Session,
    customer_id: int,
    product_model_id: int,
    quantity: int = 1,
    priority: str = "MEDIUM",
    target_date: Optional[date] = None,
    notes: Optional[str] = None,
    vendor_id: int = 1
) -> Dict[str, Any]:
    """
    Single-call orchestration for the new BVC24 workflow.

    Creates:
      1. Project (inherits product's category, skills, department)
      2. WorkOrder under that project
      3. Stage progress rows for the WO (one per active ProcessStage)
      4. TaskAssignment per stage, auto-assigned to best-skill employee,
         APPROVAL_STATUS = "PENDING" (waits for employee accept)
      5. Email notifications fired to each assigned employee

    Returns a summary dict the route serialises to JSON.
    """

    # ---- 1. Validate inputs ----
    customer = db.query(Customer).filter(
        Customer.ID == customer_id
    ).first()

    if not customer:

        raise ValueError(f"Customer {customer_id} not found")

    product = db.query(ProductModel).filter(
        ProductModel.ID == product_model_id
    ).first()

    if not product:

        raise ValueError(f"Product model {product_model_id} not found")

    if quantity < 1:

        quantity = 1

    # ---- 2. Build the project ----
    # Derive a default department from the product category by
    # looking for a matching department code. Fall back to no
    # department if none matches.
    project_dept_id = None

    dept_hints = {
        "snack-beverage":  "PRD",
        "medicine":        "PRD",
        "hot-food":        "PRD",
        "cosmetics":       "DSG",
        "grocery":         "PRD"
    }

    code_hint = dept_hints.get(
        (product.CATEGORY or "").lower(), "PRD"
    )

    dept = db.query(Department).filter(
        Department.VENDOR_ID == vendor_id,
        Department.CODE == code_hint
    ).first()

    if dept:

        project_dept_id = dept.ID

    # Aggregate skills required = union of skills from stage types
    stages_list = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == product.ID,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    # Self-heal: products created before stage auto-seeding (or
    # manually through earlier versions of the UI) have no stages,
    # which would silently produce a project with zero tasks. Seed
    # the default flow now and refetch so the rest of this function
    # works the same way for every product.
    if not stages_list:

        from app.routes.production import seed_default_stages_for_product

        seed_default_stages_for_product(db, product.ID)

        db.flush()

        stages_list = (
            db.query(ProcessStage)
            .filter(
                ProcessStage.PRODUCT_MODEL_ID == product.ID,
                ProcessStage.IS_ACTIVE == 1
            )
            .order_by(ProcessStage.SEQUENCE)
            .all()
        )

    # BOM is user-managed — do NOT auto-seed. If the product has no
    # BOM rows yet, the project drawer will simply show an empty list
    # until the admin adds lines via the Production & BOM page.

    skill_set = set()

    for s in stages_list:

        for kw in STAGE_TYPE_SKILLS.get(
            s.STAGE_TYPE or "OTHER", ""
        ).split(","):

            if kw.strip():

                skill_set.add(kw.strip())

    skills_required_str = ",".join(sorted(skill_set))

    project = Project(
        PROJECT_NAME=(
            f"{product.MODEL_NAME} — {customer.CUSTOMER_NAME} "
            f"({quantity} unit{'s' if quantity > 1 else ''})"
        ),
        DESCRIPTION=(
            f"{product.DESCRIPTION or ''}\n\n"
            f"Customer: {customer.CUSTOMER_NAME} "
            f"({customer.CUSTOMER_CODE or '-'})\n"
            f"Quantity: {quantity}\n"
            + (f"Notes: {notes}" if notes else "")
        ).strip(),
        STATUS="ACTIVE",
        PRIORITY=(priority or "MEDIUM").upper(),
        SKILLS_REQUIRED=skills_required_str,
        DEPARTMENT_ID=project_dept_id,
        CUSTOMER_ID=customer.ID,
        PRODUCT_MODEL_ID=product.ID,
        QUANTITY=quantity,
        TARGET_DATE=target_date,
        VENDOR_ID=vendor_id
    )

    db.add(project)

    db.flush()

    # ---- 3. Spawn a Work Order under the project ----
    # Reuse the WO-number generator from production routes so the
    # sequence stays globally unique (WO_NUMBER has a UNIQUE
    # index — a count-based approach collides when records were
    # deleted or vendors share the same year prefix).
    from app.routes.production import _generate_wo_number

    wo_number = _generate_wo_number(db, vendor_id)

    wo = WorkOrder(
        WO_NUMBER=wo_number,
        PRODUCT_MODEL_ID=product.ID,
        PROJECT_ID=project.ID,
        QUANTITY=quantity,
        STATUS="PLANNED",
        PLANNED_START_DATE=date.today(),
        PLANNED_END_DATE=target_date,
        NOTES=notes or f"Auto-generated for {customer.CUSTOMER_NAME}",
        VENDOR_ID=vendor_id
    )

    db.add(wo)

    try:

        db.flush()

    except Exception:

        # Race: another request grabbed our WO_NUMBER between
        # the SELECT and the INSERT. Retry once with a fresh
        # number; if it fails again let the original exception
        # propagate.
        db.rollback()

        # Recreate the project so it isn't lost on rollback
        db.add(project)

        db.flush()

        wo = WorkOrder(
            WO_NUMBER=_generate_wo_number(db, vendor_id),
            PRODUCT_MODEL_ID=product.ID,
            PROJECT_ID=project.ID,
            QUANTITY=quantity,
            STATUS="PLANNED",
            PLANNED_START_DATE=date.today(),
            PLANNED_END_DATE=target_date,
            NOTES=notes or f"Auto-generated for {customer.CUSTOMER_NAME}",
            VENDOR_ID=vendor_id
        )

        db.add(wo)

        db.flush()

    # ---- 4. Pick ONE owner for the WHOLE project ----
    # BVC24 policy: a project belongs to one person end-to-end.
    # All manufacturing stages become daily tasks for that same
    # employee — staggered across days by estimated hours.
    #
    # Fair-distribution rule (true lifetime fairness):
    # Sort all eligible workers by (lifetime_project_count ASC,
    # skill_match DESC). The worker with the FEWEST prior projects
    # ever owned wins, with skill match as the tiebreaker. So
    # Hemnath who owned 2 prior projects sits BELOW Saranya who
    # owned 0 — even if Hemnath's old tasks all completed and he
    # looks "free" by activity alone.
    project_owner, picker_log = find_fairest_owner(
        db,
        required_skills=skills_required_str,
        vendor_id=vendor_id,
        department_id=project_dept_id
    )

    # Surface owner_score for the email + downstream summaries
    owner_score = (
        (picker_log.get("picked") or {}).get("skill_match", 0)
        if picker_log else 0
    )

    # Log to uvicorn so devs can see WHY each project was assigned
    try:

        import logging

        logging.getLogger("uvicorn").info(
            "project picker: %s", picker_log
        )

    except Exception:

        pass

    # ---- 5. For each stage: spawn progress row + create task ----
    # All tasks go to project_owner. ASSIGNED_DATE is staggered:
    # each stage starts the day after the previous one's planned
    # finish, computed from ESTIMATED_HOURS (8h/day shifts).
    assigned_employees = {}

    task_summaries = []

    cursor_day = 0   # day offset from today

    WORK_HOURS_PER_DAY = 8

    # Cache stage-specialist picks across the loop so the same
    # employee isn't queried twice in a row for the same STAGE_TYPE.
    specialist_cache = {}

    for stage in stages_list:

        # Per-stage skill-matched assignment. Stage 1 is always the
        # project owner (Design Review goes to whoever's owning the
        # project). Stages 2..N look up a specialist whose SKILLS
        # match the stage's STAGE_TYPE (e.g. ELECTRICAL stage →
        # employee with 'electrical' in SKILLS / OCCUPATION).
        # Falls back to project_owner if no specialist found.
        is_first_stage = (stage == stages_list[0])

        if is_first_stage:

            assignee_id = project_owner.ID if project_owner else None

            assignee_source = "project_owner"

        else:

            stage_kw = (stage.STAGE_TYPE or "").lower().strip()

            if stage_kw and stage_kw in specialist_cache:

                specialist = specialist_cache[stage_kw]

            elif stage_kw:

                # Look up a specialist whose skills overlap with
                # this stage type. Exclude the project owner from
                # the pool so work spreads instead of piling on one
                # person — falls back to owner only if no other
                # match exists.
                exclude = (
                    {project_owner.ID} if project_owner else None
                )

                specialist, _score = find_best_employee(
                    db,
                    required_skills=stage_kw,
                    vendor_id=vendor_id,
                    department_id=project.DEPARTMENT_ID,
                    exclude_employee_ids=exclude
                )

                specialist_cache[stage_kw] = specialist

            else:

                specialist = None

            assignee_id = (
                specialist.ID if specialist
                else (project_owner.ID if project_owner else None)
            )

            assignee_source = (
                "specialist" if specialist
                else ("owner_fallback" if project_owner else "unassigned")
            )

        progress = WorkOrderStageProgress(
            WORK_ORDER_ID=wo.ID,
            STAGE_ID=stage.ID,
            STATUS="PENDING",
            ASSIGNED_TO_ID=assignee_id
        )

        db.add(progress)

        if assignee_id:

            assigned_employees[assignee_id] = (
                assigned_employees.get(assignee_id, 0) + 1
            )

        # Stagger dates: a stage needing N hours takes ceil(N/8)
        # days. Today's stage starts at cursor_day, next stage
        # starts after this one finishes.
        days_needed = max(
            1,
            ceil((stage.ESTIMATED_HOURS or WORK_HOURS_PER_DAY)
                 / WORK_HOURS_PER_DAY)
        )

        stage_assigned_date = date.today() + timedelta(days=cursor_day)

        stage_due_date = date.today() + timedelta(
            days=cursor_day + days_needed - 1
        )

        cursor_day += days_needed

        # If the user gave an absolute target_date, clamp the
        # computed DUE_DATE so we don't drift past it.
        if target_date and stage_due_date > target_date:

            stage_due_date = target_date

        task = TaskAssignment(
            EMPLOYEE_ID=assignee_id,
            PROJECT_ID=project.ID,
            TASK_NAME=f"Stage {stage.SEQUENCE}: {stage.STAGE_NAME}",
            TASK_DETAILS=(
                f"{stage.DESCRIPTION or ''}\n\n"
                f"Project: {project.PROJECT_NAME}\n"
                f"Work Order: {wo.WO_NUMBER} ({quantity} unit{'s' if quantity > 1 else ''})\n"
                f"Stage type: {stage.STAGE_TYPE} · "
                f"Estimated: {stage.ESTIMATED_HOURS}h "
                f"(~{days_needed} day{'s' if days_needed > 1 else ''})\n"
                f"Assignment: {assignee_source}"
            ).strip(),
            ASSIGNED_DATE=stage_assigned_date,
            DUE_DATE=stage_due_date,
            TASK_STATUS="PENDING",
            APPROVAL_STATUS="PENDING",   # waits for employee acceptance
            ASSIGNED_BY_ID=None,
            START_TIME=None,
            UPDATED_AT=datetime.utcnow()
        )

        db.add(task)

        db.flush()

        task_summaries.append({
            "task_id": task.TASK_ID,
            "stage_sequence": stage.SEQUENCE,
            "stage_name": stage.STAGE_NAME,
            "stage_type": stage.STAGE_TYPE,
            "assigned_date": stage_assigned_date.isoformat(),
            "due_date": stage_due_date.isoformat(),
            "estimated_hours": stage.ESTIMATED_HOURS,
            "days_needed": days_needed,
            "assigned_employee_id": project_owner.ID if project_owner else None,
            "assigned_employee_name": project_owner.NAME if project_owner else None,
            "assigned_employee_code": project_owner.EMPLOYEE_CODE if project_owner else None,
            "assigned_employee_email": project_owner.EMAIL if project_owner else None,
            "skill_match_score": owner_score if project_owner else 0,
            "approval_status": "PENDING"
        })

    db.commit()

    db.refresh(project)

    db.refresh(wo)

    # ---- 5. Fire notification emails ----
    email_results = _notify_assigned_employees(
        db, project, wo, product, customer, task_summaries
    )

    return {
        "message": (
            f"Project created from product '{product.MODEL_NAME}'. "
            f"{len(task_summaries)} task(s) generated and assigned. "
            f"Employees notified by email and awaiting acceptance."
        ),
        "project": {
            "ID": project.ID,
            "PROJECT_NAME": project.PROJECT_NAME,
            "STATUS": project.STATUS,
            "PRIORITY": project.PRIORITY,
            "QUANTITY": project.QUANTITY,
            "PRODUCT_MODEL_ID": product.ID,
            "PRODUCT_MODEL_NAME": product.MODEL_NAME,
            "PRODUCT_MODEL_CODE": product.MODEL_CODE,
            "CUSTOMER_ID": customer.ID,
            "CUSTOMER_NAME": customer.CUSTOMER_NAME,
            "DEPARTMENT_ID": project_dept_id,
            "SKILLS_REQUIRED": skills_required_str,
            "TARGET_DATE": target_date.isoformat() if target_date else None
        },
        "work_order": {
            "ID": wo.ID,
            "WO_NUMBER": wo.WO_NUMBER,
            "STATUS": wo.STATUS,
            "QUANTITY": wo.QUANTITY
        },
        "tasks_generated": len(task_summaries),
        "tasks": task_summaries,
        "employees_assigned": len(assigned_employees),
        "owner_picker_log": picker_log,
        "emails_sent": email_results
    }


# ----------------------------------------------------------------
# Email helper
# ----------------------------------------------------------------

def _notify_assigned_employees(
    db: Session,
    project: Project,
    wo: WorkOrder,
    product: ProductModel,
    customer: Customer,
    task_summaries: List[Dict]
) -> Dict:
    """Send one summary email per unique assigned employee listing
    all stages they've been asked to work on."""

    from app.services.email_service import send_alert_email, is_smtp_configured

    if not (is_smtp_configured() or
            (db.query(Employee).first()
             and (__import__("os").getenv("RESEND_API_KEY") or "").strip())):

        return {"sent": 0, "skipped": True, "reason": "Email not configured"}

    by_employee = {}

    for t in task_summaries:

        eid = t.get("assigned_employee_id")

        if not eid:

            continue

        if eid not in by_employee:

            by_employee[eid] = {
                "name": t.get("assigned_employee_name"),
                "email": t.get("assigned_employee_email"),
                "tasks": []
            }

        by_employee[eid]["tasks"].append(t)

    sent_count = 0

    failures = []

    for emp_id, bundle in by_employee.items():

        if not bundle["email"]:

            continue

        task_rows_html = "".join(
            f"""
            <tr>
              <td style="padding:6px 12px;border:1px solid #e2e8f0;">
                {t['stage_name']}
              </td>
              <td style="padding:6px 12px;border:1px solid #e2e8f0;color:#64748b;font-size:11px;">
                {t['stage_type']}
              </td>
              <td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:right;">
                {int((t.get('skill_match_score') or 0) * 100)}% match
              </td>
            </tr>
            """
            for t in bundle["tasks"]
        )

        body_html = f"""
        <html><body style="font-family:Segoe UI,sans-serif;color:#0f172a;max-width:600px;margin:0 auto;padding:24px;">

          <div style="background:linear-gradient(135deg,#0e7490,#6366f1);color:white;padding:20px 24px;border-radius:12px 12px 0 0;">
            <div style="font-size:11px;letter-spacing:1.4px;opacity:0.7;text-transform:uppercase;">
              BVC24 ERP · New Task Assignment
            </div>
            <div style="font-size:22px;font-weight:800;margin-top:4px;">
              You've been assigned to {project.PROJECT_NAME}
            </div>
          </div>

          <div style="background:white;padding:22px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">

            <p>Hi {bundle['name']},</p>

            <p>You've been auto-assigned to <strong>{len(bundle['tasks'])} stage(s)</strong>
            of a new project — based on your skill set.</p>

            <table style="width:100%;font-size:13px;line-height:1.7;margin:14px 0;">
              <tr><td style="color:#64748b;width:35%;">Project</td>
                  <td><strong>{project.PROJECT_NAME}</strong></td></tr>
              <tr><td style="color:#64748b;">Customer</td>
                  <td>{customer.CUSTOMER_NAME}</td></tr>
              <tr><td style="color:#64748b;">Product</td>
                  <td>{product.MODEL_NAME} ({product.MODEL_CODE})</td></tr>
              <tr><td style="color:#64748b;">Work Order</td>
                  <td>{wo.WO_NUMBER} · {wo.QUANTITY} unit(s)</td></tr>
              <tr><td style="color:#64748b;">Priority</td>
                  <td><strong>{project.PRIORITY}</strong></td></tr>
            </table>

            <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-top:18px;">
              Your assigned stages:
            </div>

            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
              {task_rows_html}
            </table>

            <p style="margin-top:24px;">
              <strong>Please open your employee dashboard to accept or reject these tasks.</strong>
              Approved tasks will show up under "Today's Tasks" with Start / Hold / Complete buttons.
            </p>

            <p style="font-size:12px;color:#94a3b8;margin-top:24px;">
              — BVC24 ERP · Auto-allocation
            </p>
          </div>

        </body></html>
        """

        ok, msg = send_alert_email(
            subject=(
                f"[BVC24] {len(bundle['tasks'])} task(s) assigned — "
                f"{project.PROJECT_NAME}"
            ),
            body_html=body_html,
            recipient=bundle["email"]
        )

        if ok:

            sent_count += 1

        else:

            failures.append({
                "employee_id": emp_id,
                "email": bundle["email"],
                "error": msg
            })

    return {
        "sent": sent_count,
        "failed": len(failures),
        "failures": failures
    }


# ----------------------------------------------------------------
# Backfill helper — rescue projects that were created before the
# product had any stages. Idempotent: re-running it only fills
# the gaps (missing stage progress rows + missing task assignments)
# without duplicating anything that's already there.
# ----------------------------------------------------------------

def backfill_project_tasks(
    db: Session,
    project_id: int
) -> Dict[str, Any]:

    from app.routes.production import seed_default_stages_for_product

    project = db.query(Project).filter(Project.ID == project_id).first()

    if not project:

        raise ValueError(f"Project {project_id} not found")

    if not project.PRODUCT_MODEL_ID:

        raise ValueError(
            "This project is not linked to a product. Only "
            "product-driven projects can be backfilled."
        )

    product = db.query(ProductModel).filter(
        ProductModel.ID == project.PRODUCT_MODEL_ID
    ).first()

    if not product:

        raise ValueError(
            f"Product {project.PRODUCT_MODEL_ID} no longer exists"
        )

    customer = db.query(Customer).filter(
        Customer.ID == project.CUSTOMER_ID
    ).first()

    # Ensure product has stages (seed defaults if not)
    stages_list = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == product.ID,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    if not stages_list:

        seed_default_stages_for_product(db, product.ID)

        db.flush()

        stages_list = (
            db.query(ProcessStage)
            .filter(
                ProcessStage.PRODUCT_MODEL_ID == product.ID,
                ProcessStage.IS_ACTIVE == 1
            )
            .order_by(ProcessStage.SEQUENCE)
            .all()
        )

    # BOM is user-managed — do NOT auto-seed. The admin defines each
    # line manually via the Production & BOM page so every project's
    # BOM reflects the real materials for that specific machine.
    bom_seeded = 0

    # Find or create the project's work order
    wo = db.query(WorkOrder).filter(
        WorkOrder.PROJECT_ID == project.ID
    ).order_by(WorkOrder.ID).first()

    if not wo:

        from app.routes.production import _generate_wo_number

        wo = WorkOrder(
            WO_NUMBER=_generate_wo_number(db, project.VENDOR_ID),
            PRODUCT_MODEL_ID=product.ID,
            PROJECT_ID=project.ID,
            QUANTITY=project.QUANTITY or 1,
            STATUS="PLANNED",
            PLANNED_START_DATE=date.today(),
            PLANNED_END_DATE=project.TARGET_DATE,
            NOTES=f"Backfilled for {customer.CUSTOMER_NAME if customer else project.PROJECT_NAME}",
            VENDOR_ID=project.VENDOR_ID
        )

        db.add(wo)

        db.flush()

    # Existing stage progress + existing tasks (so we don't duplicate)
    existing_progress_stage_ids = {
        row.STAGE_ID
        for row in db.query(WorkOrderStageProgress).filter(
            WorkOrderStageProgress.WORK_ORDER_ID == wo.ID
        ).all()
    }

    existing_task_names = {
        t.TASK_NAME
        for t in db.query(TaskAssignment).filter(
            TaskAssignment.PROJECT_ID == project.ID
        ).all()
    }

    task_summaries = []

    assigned_employees = {}

    quantity = project.QUANTITY or 1

    target_date = project.TARGET_DATE

    # Same single-owner policy as create_project_from_product:
    # pick ONE employee for the whole project using the project's
    # aggregated skills, then assign every stage's task to them.
    skill_set = set()

    for s in stages_list:

        for kw in STAGE_TYPE_SKILLS.get(
            s.STAGE_TYPE or "OTHER", ""
        ).split(","):

            kw = kw.strip()

            if kw:

                skill_set.add(kw)

    skills_str = ",".join(sorted(skill_set))

    # Same true-fair picker as create_project_from_product —
    # lifetime project count + skill match, no exclude lists.
    # If this project already has an owner who's still the
    # best fit, the picker will naturally pick them again
    # (their prior count includes this project, but everyone
    # else is compared on equal footing).
    project_owner, picker_log = find_fairest_owner(
        db,
        required_skills=skills_str,
        vendor_id=project.VENDOR_ID,
        department_id=project.DEPARTMENT_ID
    )

    owner_score = (
        (picker_log.get("picked") or {}).get("skill_match", 0)
        if picker_log else 0
    )

    try:

        import logging

        logging.getLogger("uvicorn").info(
            "backfill picker: %s", picker_log
        )

    except Exception:

        pass

    cursor_day = 0

    WORK_HOURS_PER_DAY = 8

    for stage in stages_list:

        # Stage progress row — create only if missing
        if stage.ID not in existing_progress_stage_ids:

            progress = WorkOrderStageProgress(
                WORK_ORDER_ID=wo.ID,
                STAGE_ID=stage.ID,
                STATUS="PENDING",
                ASSIGNED_TO_ID=project_owner.ID if project_owner else None
            )

            db.add(progress)

        else:

            progress = db.query(WorkOrderStageProgress).filter(
                WorkOrderStageProgress.WORK_ORDER_ID == wo.ID,
                WorkOrderStageProgress.STAGE_ID == stage.ID
            ).first()

            if progress and project_owner:

                progress.ASSIGNED_TO_ID = project_owner.ID

        task_name = f"Stage {stage.SEQUENCE}: {stage.STAGE_NAME}"

        # Compute staggered dates regardless — we use the cursor
        # whether or not we end up creating a task this iteration,
        # so the schedule stays consistent if the user re-runs
        # backfill after partially completing some stages.
        days_needed = max(
            1,
            ceil((stage.ESTIMATED_HOURS or WORK_HOURS_PER_DAY)
                 / WORK_HOURS_PER_DAY)
        )

        stage_assigned_date = date.today() + timedelta(days=cursor_day)

        stage_due_date = date.today() + timedelta(
            days=cursor_day + days_needed - 1
        )

        cursor_day += days_needed

        if target_date and stage_due_date > target_date:

            stage_due_date = target_date

        # Task assignment — skip if already exists (idempotent)
        if task_name in existing_task_names:

            continue

        if project_owner:

            assigned_employees[project_owner.ID] = (
                assigned_employees.get(project_owner.ID, 0) + 1
            )

        task = TaskAssignment(
            EMPLOYEE_ID=project_owner.ID if project_owner else None,
            PROJECT_ID=project.ID,
            TASK_NAME=task_name,
            TASK_DETAILS=(
                f"{stage.DESCRIPTION or ''}\n\n"
                f"Project: {project.PROJECT_NAME}\n"
                f"Work Order: {wo.WO_NUMBER} ({quantity} unit{'s' if quantity > 1 else ''})\n"
                f"Stage type: {stage.STAGE_TYPE} · "
                f"Estimated: {stage.ESTIMATED_HOURS}h "
                f"(~{days_needed} day{'s' if days_needed > 1 else ''})"
            ).strip(),
            ASSIGNED_DATE=stage_assigned_date,
            DUE_DATE=stage_due_date,
            TASK_STATUS="PENDING",
            APPROVAL_STATUS="PENDING",
            ASSIGNED_BY_ID=None,
            START_TIME=None,
            UPDATED_AT=datetime.utcnow()
        )

        db.add(task)

        db.flush()

        task_summaries.append({
            "task_id": task.TASK_ID,
            "stage_sequence": stage.SEQUENCE,
            "stage_name": stage.STAGE_NAME,
            "stage_type": stage.STAGE_TYPE,
            "assigned_date": stage_assigned_date.isoformat(),
            "due_date": stage_due_date.isoformat(),
            "estimated_hours": stage.ESTIMATED_HOURS,
            "days_needed": days_needed,
            "assigned_employee_id": project_owner.ID if project_owner else None,
            "assigned_employee_name": project_owner.NAME if project_owner else None,
            "assigned_employee_code": project_owner.EMPLOYEE_CODE if project_owner else None,
            "assigned_employee_email": project_owner.EMAIL if project_owner else None,
            "skill_match_score": owner_score if project_owner else 0,
            "approval_status": "PENDING"
        })

    db.commit()

    db.refresh(project)

    db.refresh(wo)

    email_results = (
        _notify_assigned_employees(
            db, project, wo, product, customer, task_summaries
        )
        if task_summaries and customer
        else {"sent": 0, "skipped": True, "reason": "No new tasks to notify about"}
    )

    return {
        "message": (
            f"Backfill complete: {len(task_summaries)} new task(s) "
            f"generated for project '{project.PROJECT_NAME}'."
            if task_summaries else
            f"Project '{project.PROJECT_NAME}' already had every "
            f"stage assigned — nothing to backfill."
        ),
        "project_id": project.ID,
        "work_order_id": wo.ID,
        "work_order_number": wo.WO_NUMBER,
        "stages_total": len(stages_list),
        "tasks_generated": len(task_summaries),
        "tasks": task_summaries,
        "employees_assigned": len(assigned_employees),
        "bom_lines_seeded": bom_seeded,
        "emails_sent": email_results
    }
