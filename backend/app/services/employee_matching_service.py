"""Centralized employee-to-task matching for the automatic task
assignment engine — the single place this priority order is implemented,
so it's used consistently everywhere tasks are matched to employees
rather than re-derived per call site.

Matching priority (as specified): same vendor -> active employee ->
matching department -> matching role -> best available experience match
(closest to the requested level, widening across levels rather than
hard-failing on an exact-label mismatch — see `find_candidates()`'s
docstring) -> available within the required production schedule.

Ranking among matches: closest experience-level match first, then
available now, then earliest availability date, then lower active
workload (mirrors the existing `workload_service.py`'s "fewest active
tasks" idiom, applied against CustomerProjectTask instead of the legacy
TaskAssignment table), then a deterministic tie-break by EMPLOYEE_CODE/ID
so repeated runs over the same data always produce the same assignment.

A genuine manpower shortage is now only ever `len(result) < required_
count` AFTER this best-effort, level-widening search — never merely
"the exact requested label wasn't found." This is the fix for false
shortages reported against departments/roles that do have qualified
employees, just not classified at precisely the requested level (see
employee_experience_service.classify_pool_relative() for why fixed
experience-year thresholds were the wrong tool for that classification
in the first place)."""

from collections import defaultdict
from datetime import datetime
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Employee, CustomerProjectTask, TaskTemplate
from app.services.employee_experience_service import classify_pool_relative
from app.services.employee_availability_service import (
    OCCUPIED_STATUSES,
    get_busy_until,
    ReservationLedger,
)

_LEVEL_RANK = {"FRESHER": 0, "INTERMEDIATE": 1, "EXPERIENCED": 2}


def _fallback_priority(requested_level: str) -> dict:
    """Maps every experience level to a priority integer (0 = best) for a
    given requested level: the exact match is always best; beyond that,
    the closer level wins, and an equidistant tie is broken toward the
    HIGHER level (e.g. for an INTERMEDIATE request with no INTERMEDIATE
    employee available, an EXPERIENCED employee is preferred over a
    FRESHER one)."""
    r = _LEVEL_RANK[requested_level]
    order = sorted(_LEVEL_RANK, key=lambda lvl: (abs(_LEVEL_RANK[lvl] - r), -_LEVEL_RANK[lvl]))
    return {lvl: i for i, lvl in enumerate(order)}


def _active_workload_count(db: Session, employee_ids: List[str]) -> dict:
    if not employee_ids:
        return {}
    rows = db.query(
        CustomerProjectTask.EMPLOYEE_ID,
        func.count(CustomerProjectTask.ID).label("cnt"),
    ).filter(
        CustomerProjectTask.EMPLOYEE_ID.in_(employee_ids),
        CustomerProjectTask.STATUS.in_(OCCUPIED_STATUSES),
    ).group_by(CustomerProjectTask.EMPLOYEE_ID).all()
    return {row[0]: row[1] for row in rows}


def find_candidates(
    db: Session,
    vendor_id: int,
    department_id: Optional[int],
    role_id: Optional[int],
    experience_level: str,
    required_count: int,
    desired_start: datetime,
    *,
    reservations: Optional[ReservationLedger] = None,
) -> List[dict]:
    """Returns up to `required_count` ranked candidate dicts:
    `{employee, available_instant, available_now}`, best match first.

    Best-effort across experience levels: employees are ranked by how
    close their POOL-RELATIVE classification (see
    employee_experience_service.classify_pool_relative(), computed
    per-(department, role) group so ranking is always against the actual
    real peers an employee has, never a mismatched cross-department
    comparison) is to `experience_level`, never filtered out purely for
    not exactly matching it. May still return fewer than `required_count`
    entries if the department+role pool itself is smaller than that — a
    genuine headcount shortage, which callers must detect via
    `len(result) < required_count`.

    `reservations`, when given, is consulted (in addition to the real
    get_busy_until() DB check) so multiple calls within the SAME
    planning pass never double-book an employee across parallel
    units/items — see ReservationLedger's own docstring."""

    query = db.query(Employee).filter(
        Employee.VENDOR_ID == vendor_id,
        Employee.STATUS == "ACTIVE",
    )
    if department_id is not None:
        query = query.filter(Employee.DEPARTMENT_ID == department_id)
    if role_id is not None:
        query = query.filter(Employee.ROLE_ID == role_id)

    pool = query.all()
    if not pool:
        return []

    # Classify each employee against their REAL (department, role) peers
    # — grouped by the employee's own fields, not just the query filter,
    # since either filter may be None and pull in a mixed pool.
    groups: dict = defaultdict(list)
    for e in pool:
        groups[(e.DEPARTMENT_ID, e.ROLE_ID)].append(e)
    levels_by_id: dict = {}
    for group_employees in groups.values():
        levels_by_id.update(classify_pool_relative(group_employees))

    priority = _fallback_priority(experience_level)
    workload = _active_workload_count(db, [e.ID for e in pool])

    ranked = []
    for emp in pool:
        busy_until = (
            reservations.effective_busy_until(db, emp.ID) if reservations is not None
            else get_busy_until(db, emp.ID)
        )
        available_now = not busy_until or busy_until <= desired_start
        available_instant = desired_start if available_now else busy_until
        ranked.append({
            "employee": emp,
            "available_instant": available_instant,
            "available_now": available_now,
            "_level": levels_by_id.get(emp.ID, "FRESHER"),
            "_workload": workload.get(emp.ID, 0),
        })

    ranked.sort(key=lambda r: (
        priority.get(r["_level"], len(priority)),
        0 if r["available_now"] else 1,
        r["available_instant"],
        r["_workload"],
        r["employee"].EMPLOYEE_CODE or r["employee"].ID,
    ))

    top = ranked[:required_count]
    for r in top:
        r.pop("_workload", None)
        r.pop("_level", None)
    return top


def estimate_parallel_capacity(db: Session, vendor_id: int, unit_scope_tasks: List[TaskTemplate], quantity: int) -> int:
    """How many QUANTITY units of a project can realistically run in
    parallel, given actual available manpower — headcount only
    (experience-level-agnostic: capacity is "how many bodies exist for
    this department+role," not "how many at exactly one level," since a
    best-effort match can use any available level per find_candidates()
    above).

    For every manpower requirement on every TASK_SCOPE=UNIT task
    template, computes floor(active_headcount_for_that_department+role /
    REQUIRED_COUNT) — the number of times that requirement's headcount
    need can be fully met simultaneously — and returns the minimum across
    every such requirement (the tightest bottleneck), capped at
    `quantity` (never propose more parallelism than there are units to
    run) and floored at 1. A project with no UNIT-scope manpower
    requirements at all has no headcount-derived ceiling, so returns
    `quantity` unchanged."""
    quantity = max(1, int(quantity or 1))
    requirements = [
        req
        for task in unit_scope_tasks
        for req in (task.requirements or [])
    ]
    if not requirements:
        return quantity

    pool_size_cache: dict = {}
    capacity = quantity
    for req in requirements:
        key = (req.DEPARTMENT_ID, req.ROLE_ID)
        if key not in pool_size_cache:
            q = db.query(Employee).filter(Employee.VENDOR_ID == vendor_id, Employee.STATUS == "ACTIVE")
            if req.DEPARTMENT_ID is not None:
                q = q.filter(Employee.DEPARTMENT_ID == req.DEPARTMENT_ID)
            if req.ROLE_ID is not None:
                q = q.filter(Employee.ROLE_ID == req.ROLE_ID)
            pool_size_cache[key] = q.count()
        pool_size = pool_size_cache[key]
        required = max(1, int(req.REQUIRED_COUNT or 1))
        req_capacity = pool_size // required
        capacity = min(capacity, req_capacity)

    return max(1, min(capacity, quantity))
