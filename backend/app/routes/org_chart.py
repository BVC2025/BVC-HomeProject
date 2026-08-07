"""
Organization chart endpoint.

  GET /org/chart              -> nested tree of every active employee,
                                  rooted at the topmost employees (those
                                  with no reporting manager). Each node
                                  carries display metadata (name,
                                  designation, department, photo) plus
                                  its children.

Vendor-scoped from the JWT so employees never see other companies'
hierarchies. Called by the ESS Org-Chart panel.
"""

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_user
from app.models.models import (
    Employee,
    Department,
    Designation,
)


router = APIRouter(prefix="/org", tags=["Organization Chart"])


def _photo_url(emp: Employee) -> Optional[str]:
    """Return the employee's photo URL if any. Relative /static/…
    paths are returned as-is; the frontend prepends API_BASE_URL."""
    url = getattr(emp, "PHOTO_URL", None)
    if not url:
        return None
    return url


def _serialize_node(
    emp: Employee,
    dept_map: dict,
    desig_map: dict,
    children,
    is_me: bool,
) -> dict:
    return {
        "id": emp.ID,
        "code": emp.EMPLOYEE_CODE,
        "name": emp.NAME or "—",
        "designation": desig_map.get(emp.DESIGNATION_ID),
        "department": dept_map.get(emp.DEPARTMENT_ID),
        "photo_url": _photo_url(emp),
        "is_me": is_me,
        "children": children,
    }


@router.get("/chart")
def get_org_chart(
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the whole vendor's reporting tree as a nested dict.

    Response shape:
        {
          "root_count": 1,
          "roots": [ { id, name, designation, department, photo_url,
                       is_me, children: [ ... ] } ],
          "me": "<my employee id>"
        }
    """

    vendor_id = payload.get("vendor_id") or 1
    me_id     = payload.get("employee_id")

    # Pull every active employee in the vendor once — we build the
    # tree in memory to avoid N recursive queries.
    emps = (
        db.query(Employee)
        .filter(Employee.VENDOR_ID == vendor_id)
        .filter(Employee.STATUS == "ACTIVE")
        .order_by(Employee.NAME.asc())
        .all()
    )

    # Batch-resolve dept + designation names so we don't fire N joins.
    dept_ids  = {e.DEPARTMENT_ID  for e in emps if e.DEPARTMENT_ID}
    desig_ids = {e.DESIGNATION_ID for e in emps if e.DESIGNATION_ID}

    dept_map = {}
    if dept_ids:
        for d in db.query(Department).filter(Department.ID.in_(dept_ids)).all():
            dept_map[d.ID] = getattr(d, "DEPARTMENT_NAME", None) or getattr(d, "NAME", None)

    desig_map = {}
    if desig_ids:
        for de in db.query(Designation).filter(Designation.ID.in_(desig_ids)).all():
            desig_map[de.ID] = getattr(de, "DESIGNATION_NAME", None) or getattr(de, "NAME", None)

    # Index employees by manager id so a parent can find its children
    # in O(1). Employees whose manager isn't in the active set (or is
    # NULL) become roots — that catches both the actual top-of-org
    # employees and any orphans whose manager left / was deactivated.
    by_manager: dict = {}
    all_ids = {e.ID for e in emps}
    for e in emps:
        parent = e.REPORTING_MANAGER_ID
        if parent not in all_ids:
            parent = None
        by_manager.setdefault(parent, []).append(e)

    def build(parent_id):
        return [
            _serialize_node(
                e,
                dept_map,
                desig_map,
                build(e.ID),
                is_me=(e.ID == me_id),
            )
            for e in by_manager.get(parent_id, [])
        ]

    roots = build(None)

    return {
        "root_count": len(roots),
        "roots": roots,
        "me": me_id,
        "total_employees": len(emps),
    }
