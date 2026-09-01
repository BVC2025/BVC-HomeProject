"""Task generation for the automatic production scheduling engine.

`build_schedule_plan()` is the single, shared core: it walks a project's
Task Group / sequence / manpower structure starting from a given instant,
matching real employees via `employee_matching_service` for every
manpower requirement, and produces a full plan. It runs in two modes:

  - `dry_run=True` (used by `production_scheduling_service.
    evaluate_and_propose_schedule()`) — compute-only, no
    `CustomerProjectTask` rows created. The resulting plan becomes the
    suggested date/reason and the `ProductionSchedule.PLAN_SNAPSHOT_JSON`
    shown in the approval email/page.
  - `dry_run=False` (used by `generate_tasks_for_schedule()`, called once
    a schedule is approved) — the SAME walk, re-run fresh (employee
    availability may have shifted since the proposal was made) and this
    time persisting a real `CustomerProjectTask` row per matched employee
    per manpower slot.

Scheduling rules (matching this session's already-verified
`calculate_project_estimated_duration()` semantics exactly, applied
against the real calendar instead of abstract hours):
  - A TaskGroup's members always run in parallel, and the group's own
    displayed span / contribution to `overall_end` is always the MAX of
    its members' end instants (a straggler member must still genuinely
    finish before the project is done, no matter what gates the NEXT
    item) — matching the duration engine's own established MAX-per-group
    convention. Separately, WHEN THE NEXT SEQUENTIAL item may start is
    gated by `TaskGroup.DEPENDENCY_RULE`: ALL (default) waits for every
    member (= the same MAX), ANY only needs the fastest member (MIN),
    ONE waits only for the specific `DEPENDS_ON_TASK_TEMPLATE_ID` member.
    This is a static, one-shot computation over each member's *planned*
    end instant — it does not require and does not call
    `task_dependency_service.can_task_start()` (a separate pure function
    reserved for a future LIVE execution-status engine that doesn't
    exist yet in this codebase — no TaskTemplate-level live status
    pipeline exists to feed it).
  - Top-level items (each group, each standalone task) combine by
    `Project.ASSIGNMENT_MODE`: SEQUENTIAL chains them (each starts only
    once the previous one's gating condition above is satisfied);
    PARALLEL starts every top-level item at the same instant.
  - `TASK_SCOPE=PROJECT` items are scheduled once; `TASK_SCOPE=UNIT`
    items are scheduled once per `assignment.QUANTITY`, each unit
    progressing independently (a faster unit is not held back by a
    slower one) except where they contend for the same employees — this
    contention is what a per-planning-pass `ReservationLedger` (see
    employee_availability_service.py) exists to correctly serialize:
    without it, `find_candidates()` would query the DB as it stood
    before this pass started (SessionLocal has autoflush=False, and this
    function only flushes once at the end) and could match the SAME
    scarce employee to multiple parallel units at the same instant. A
    TaskGroup whose members have mixed scope schedules each member
    according to its own `TASK_SCOPE` — a rare edge case, not a
    configured business rule, handled gracefully rather than specially.
  - `overall_start` (and therefore `estimated_duration_days`, computed
    as literal calendar-date arithmetic against it) is the earliest
    instant any first-wave task's manpower can genuinely begin — the
    same anchor shown to the user as SUGGESTED_START_DATE — not the raw
    `start_instant` parameter, which may be earlier than any employee
    can actually start. This keeps `SUGGESTED_START_DATE +
    ESTIMATED_DURATION_DAYS == ESTIMATED_COMPLETION_DATE` a structural
    identity rather than two independently-computed numbers.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Project, TaskTemplate, CustomerProjectTask, CustomerProjectAssignment,
    CompanyWorkingBreak,
)
from app.utils.datetime_utils import now_ist
from app.services.company_settings_service import get_company_settings
from app.services import company_schedule_service
from app.services.employee_matching_service import find_candidates, estimate_parallel_capacity
from app.services.employee_availability_service import ReservationLedger

_UNIT_TO_DAYS = {"DAYS": 1.0, "WEEKS": 5.0, "MONTHS": 22.0, "YEARS": 260.0}


def _duration_hours(task: TaskTemplate, work_hours: float) -> float:
    unit = (task.DURATION_UNIT or "DAYS").upper()
    val = float(task.DURATION_VALUE or 0)
    if unit == "HOURS":
        return val
    return val * _UNIT_TO_DAYS.get(unit, 1.0) * work_hours


def _load_work_schedule(db: Session, vendor_id: int):
    company = get_company_settings(db, vendor_id)
    work_hours = float(company.WORK_HOURS) if company.WORK_HOURS and float(company.WORK_HOURS) > 0 else 8.0
    breaks = company_schedule_service.breaks_to_dicts(
        db.query(CompanyWorkingBreak).filter(
            CompanyWorkingBreak.COMPANY_MASTER_ID == company.ID,
            CompanyWorkingBreak.IS_ACTIVE.is_(True),
        ).all()
    )
    return company, work_hours, breaks


def _build_top_level_items(tasks: list) -> list:
    """Buckets tasks into ordered top-level items (mirrors
    `calculate_project_estimated_duration`'s own grouping): each item is
    either a single standalone task or a whole TaskGroup's member list,
    sorted by the item's own SEQUENCE_NUMBER (`TaskGroup.SEQUENCE_NUMBER`
    for groups, `TaskTemplate.SEQUENCE_NUMBER` for standalone tasks)."""
    groups: dict = {}
    standalone = []
    for t in tasks:
        if t.TASK_GROUP_ID:
            bucket = groups.setdefault(t.TASK_GROUP_ID, {"group": t.task_group, "members": []})
            bucket["members"].append(t)
        else:
            standalone.append(t)

    items = []
    for bucket in groups.values():
        items.append({"kind": "group", "group": bucket["group"], "members": bucket["members"], "seq": bucket["group"].SEQUENCE_NUMBER})
    for t in standalone:
        items.append({"kind": "task", "group": None, "members": [t], "seq": t.SEQUENCE_NUMBER})
    items.sort(key=lambda i: i["seq"])
    return items


def _gating_end(item: dict, member_plans_subset: list):
    """When may the NEXT sequential top-level item start, given this
    item's members? A standalone task always gates on its own single
    end. A TaskGroup honors its own DEPENDENCY_RULE: ALL (default) = every
    member (MAX, same as the group's own displayed span); ANY = the
    fastest member (MIN); ONE = the specific DEPENDS_ON_TASK_TEMPLATE_ID
    member's own end. Falls back to ALL/MAX if a ONE-rule's target member
    isn't present in this subset (e.g. it belongs to the other scope in a
    rare mixed PROJECT/UNIT-scope group) rather than guessing. Returns
    None for an empty subset — caller handles that."""
    if not member_plans_subset:
        return None
    group = item.get("group")
    if not group or item.get("kind") != "group":
        return max(mp["end"] for mp in member_plans_subset)
    rule = group.DEPENDENCY_RULE or "ALL"
    if rule == "ANY":
        return min(mp["end"] for mp in member_plans_subset)
    if rule == "ONE" and group.DEPENDS_ON_TASK_TEMPLATE_ID:
        for mp in member_plans_subset:
            if mp["task_template_id"] == group.DEPENDS_ON_TASK_TEMPLATE_ID:
                return mp["end"]
    return max(mp["end"] for mp in member_plans_subset)


def build_schedule_plan(
    db: Session,
    assignment: CustomerProjectAssignment,
    project: Project,
    start_instant: datetime,
    *,
    dry_run: bool = True,
) -> dict:
    """Returns a plan dict: `{items, overall_start, overall_end,
    estimated_duration_days, shortages, created_rows, parallel_capacity,
    unit_summaries, manpower_summary}` (`created_rows` only populated
    when `dry_run=False`). Raises
    `company_schedule_service.ScheduleValidationError` if the vendor
    hasn't configured working hours yet, or `ValueError` if the project
    has no tasks — both are caller-facing, user-fixable conditions."""

    company, work_hours, breaks = _load_work_schedule(db, assignment.VENDOR_ID)
    if not company.WORK_START_TIME or not company.WORK_END_TIME:
        raise company_schedule_service.ScheduleValidationError(
            "Company working hours are not configured yet — configure them on the "
            "Company Profile page before production can be scheduled."
        )

    tasks = (
        db.query(TaskTemplate)
          .filter(TaskTemplate.PROJECT_ID == project.ID)
          .order_by(TaskTemplate.SEQUENCE_NUMBER)
          .all()
    )
    if not tasks:
        raise ValueError("This project has no configured tasks to schedule.")

    top_level_items = _build_top_level_items(tasks)
    quantity = int(assignment.QUANTITY or 1)
    units = list(range(1, quantity + 1))

    plan_items = []
    shortages = []
    created_rows = []
    reservations = ReservationLedger()

    project_cursor = start_instant
    unit_cursors = {u: start_instant for u in units}

    def schedule_member(task: TaskTemplate, unit: Optional[int], item_start: datetime) -> dict:
        member_plan = {
            "task_template_id": task.ID,
            "task_name": task.NAME,
            "unit": unit,
            "requirements": [],
            "start": item_start,
            "end": item_start,
        }
        duration_hours = _duration_hours(task, work_hours)
        reqs = task.requirements or []

        if not reqs:
            # No manpower requirement configured — the task still
            # occupies the calendar (e.g. a machine/process step with no
            # assigned person), scheduled purely against the company
            # working calendar.
            sched = company_schedule_service.calculate_task_schedule(
                company.WORK_START_TIME, company.WORK_END_TIME, breaks, item_start, duration_hours
            )
            member_plan["start"] = sched["segments"][0]["start"] if sched["segments"] else item_start
            member_plan["end"] = sched["end_datetime"]
            return member_plan

        latest_end = item_start
        earliest_start = None
        for req in reqs:
            dept_name = req.department.NAME if req.department else None
            role_name = req.role.NAME if req.role else None
            candidates = find_candidates(
                db, assignment.VENDOR_ID, req.DEPARTMENT_ID, req.ROLE_ID,
                req.EXPERIENCE_LEVEL, req.REQUIRED_COUNT, item_start,
                reservations=reservations,
            )
            matches = []
            for c in candidates:
                sched = company_schedule_service.calculate_task_schedule(
                    company.WORK_START_TIME, company.WORK_END_TIME, breaks,
                    c["available_instant"], duration_hours,
                )
                m_start = sched["segments"][0]["start"] if sched["segments"] else c["available_instant"]
                m_end = sched["end_datetime"]
                matches.append({"employee_id": c["employee"].ID, "employee_name": c["employee"].NAME, "start": m_start, "end": m_end})
                # Reserve immediately — before the next requirement/unit
                # is scheduled in this SAME pass — so a competing parallel
                # slot never matches this same employee to an overlapping
                # window (see ReservationLedger's own docstring for why a
                # live DB re-query alone can't catch this within one pass).
                reservations.reserve(c["employee"].ID, m_end)
                if earliest_start is None or m_start < earliest_start:
                    earliest_start = m_start
                if m_end > latest_end:
                    latest_end = m_end

            missing = req.REQUIRED_COUNT - len(matches)
            if missing > 0:
                shortages.append({
                    "task_name": task.NAME, "department": dept_name, "role": role_name,
                    "experience_level": req.EXPERIENCE_LEVEL, "missing_count": missing,
                })

            member_plan["requirements"].append({
                "department": dept_name, "role": role_name,
                "experience_level": req.EXPERIENCE_LEVEL,
                "required_count": req.REQUIRED_COUNT,
                "matched_count": len(matches),
                "matches": matches,
            })

            if not dry_run:
                for m in matches:
                    row = CustomerProjectTask(
                        ASSIGNMENT_ID=assignment.ID,
                        TASK_TEMPLATE_ID=task.ID,
                        EMPLOYEE_ID=m["employee_id"],
                        PROJECT_UNIT_NUMBER=unit,
                        ESTIMATED_HOURS=round(duration_hours, 2),
                        ESTIMATED_DAYS=round(duration_hours / work_hours) if work_hours else 0,
                        ASSIGNED_DATE=now_ist(),
                        PLANNED_START_DATE=m["start"],
                        DUE_DATE=m["end"],
                        STATUS="PENDING",
                    )
                    db.add(row)
                    created_rows.append(row)

        if earliest_start is None:
            # Every requirement on this task came up with zero matching
            # employees (a genuine, total manpower shortage — already
            # recorded above in `shortages`) — fall back to the task's
            # own configured duration against the company calendar so
            # the estimate doesn't silently collapse to zero. This keeps
            # the overall project timeline realistic (assuming the
            # shortage gets resolved before this task's turn comes up)
            # while the shortage itself is still surfaced separately.
            sched = company_schedule_service.calculate_task_schedule(
                company.WORK_START_TIME, company.WORK_END_TIME, breaks, item_start, duration_hours
            )
            member_plan["start"] = sched["segments"][0]["start"] if sched["segments"] else item_start
            member_plan["end"] = sched["end_datetime"]
        else:
            member_plan["start"] = earliest_start
            member_plan["end"] = latest_end
        return member_plan

    for item in top_level_items:
        members = item["members"]
        project_scope_members = [m for m in members if (m.TASK_SCOPE or "PROJECT") == "PROJECT"]
        unit_scope_members = [m for m in members if (m.TASK_SCOPE or "PROJECT") == "UNIT"]

        item_start = project_cursor
        member_plans = []

        for m in project_scope_members:
            member_plans.append(schedule_member(m, None, item_start))

        for u in units:
            u_start = unit_cursors[u]
            for m in unit_scope_members:
                member_plans.append(schedule_member(m, u, u_start))

        item_end = max((mp["end"] for mp in member_plans), default=item_start)
        plan_items.append({
            "kind": item["kind"],
            "name": item["group"].NAME if item["group"] else members[0].NAME,
            "start": item_start,
            "end": item_end,
            "members": member_plans,
        })

        if project.ASSIGNMENT_MODE == "SEQUENTIAL":
            if project_scope_members:
                relevant = [mp for mp in member_plans if mp["unit"] is None]
                gating_end = _gating_end(item, relevant)
                if gating_end is not None:
                    project_cursor = gating_end
                    for u in units:
                        unit_cursors[u] = max(unit_cursors[u], gating_end)
            if unit_scope_members:
                for u in units:
                    this_unit_plans = [mp for mp in member_plans if mp["unit"] == u]
                    gating_end = _gating_end(item, this_unit_plans)
                    if gating_end is not None:
                        unit_cursors[u] = gating_end
        # PARALLEL: cursors intentionally never advance — every top-level
        # item starts at start_instant, matching calculate_project_
        # estimated_duration's own PARALLEL=MAX-at-top-level semantics.

    overall_end = project_cursor
    for u in units:
        overall_end = max(overall_end, unit_cursors[u])
    if plan_items:
        overall_end = max(overall_end, *(i["end"] for i in plan_items))

    # overall_start: the earliest instant any first-wave task's manpower
    # can genuinely begin (a first-wave item is one whose own item['start']
    # equals the raw start_instant this pass was run against — i.e. not
    # waiting on an earlier SEQUENTIAL item). This is the SAME anchor
    # production_scheduling_service shows as SUGGESTED_START_DATE, and
    # estimated_duration_days below is computed against it directly — a
    # structural identity, not two independently-computed numbers.
    first_wave = [pi for pi in plan_items if pi["start"] == start_instant]
    first_wave_member_starts = [mp["start"] for pi in first_wave for mp in pi["members"]]
    overall_start = min(first_wave_member_starts) if first_wave_member_starts else start_instant

    estimated_days = (overall_end.date() - overall_start.date()).days

    unit_scope_tasks = [t for t in tasks if (t.TASK_SCOPE or "PROJECT") == "UNIT"]
    parallel_capacity = estimate_parallel_capacity(db, assignment.VENDOR_ID, unit_scope_tasks, quantity)

    unit_summaries = []
    for u in units:
        u_starts = [mp["start"] for pi in plan_items for mp in pi["members"] if mp["unit"] == u]
        u_ends = [mp["end"] for pi in plan_items for mp in pi["members"] if mp["unit"] == u]
        if u_starts:
            unit_summaries.append({"unit": u, "start": min(u_starts), "end": max(u_ends)})

    manpower_agg: dict = {}
    for pi in plan_items:
        for mp in pi["members"]:
            for req in mp["requirements"]:
                key = (req["department"], req["role"], req["experience_level"])
                bucket = manpower_agg.setdefault(key, {"required": 0, "matched": 0, "employees": set()})
                bucket["required"] += req["required_count"]
                bucket["matched"] += req["matched_count"]
                for m in req["matches"]:
                    bucket["employees"].add(m["employee_name"])
    manpower_summary = [
        {
            "department": dept, "role": role, "experience_level": exp,
            "required": b["required"], "matched": b["matched"],
            "employees": sorted(b["employees"]),
        }
        for (dept, role, exp), b in manpower_agg.items()
    ]

    plan = {
        "items": plan_items,
        "overall_start": overall_start,
        "overall_end": overall_end,
        "estimated_duration_days": estimated_days,
        "shortages": shortages,
        "created_rows": created_rows,
        "parallel_capacity": parallel_capacity,
        "unit_summaries": unit_summaries,
        "manpower_summary": manpower_summary,
    }

    if not dry_run:
        db.flush()

    return plan


def generate_tasks_for_schedule(db: Session, schedule, assignment: CustomerProjectAssignment, project: Project) -> dict:
    """Called once a ProductionSchedule is approved (or rejected-and-
    rescheduled) — re-runs `build_schedule_plan()` fresh (employee
    availability may have shifted since the original proposal) starting
    from the schedule's chosen or suggested start date, this time
    persisting real `CustomerProjectTask` rows. Returns the full plan
    dict (`plan["created_rows"]` holds the created rows) so callers can
    also refresh the schedule's date/duration fields and the per-unit/
    manpower summaries from the SAME real generation pass, without a
    second call. Idempotency (never generate twice for the same
    schedule) is enforced by the caller checking `schedule.
    TASKS_GENERATED_AT` before calling this — this function itself always
    generates when called."""
    start_instant = schedule.CHOSEN_START_DATE or schedule.SUGGESTED_START_DATE
    return build_schedule_plan(db, assignment, project, start_instant, dry_run=False)
