"""
employee_resolver.py  —  Single source of truth for "given an employee
identifier (UUID or EMPLOYEE_CODE), return the canonical UUID".

Why this exists
---------------
The /employee-login response sets `EMPLOYEE_ID` to the employee's CODE
(e.g. "EMP101") rather than their underlying UUID, kept that way for
legacy frontend compatibility. As a result, every downstream route
that filters on `Employee.ID == <param>` 404s when called from a
self-service endpoint that received the CODE in its body/URL.

`assert_self_or_admin` already accepts both forms; we just need the
same flexibility at the DB-query layer. This module gives that.

Usage
-----
    from app.utils.employee_resolver import resolve_employee_uuid

    # In a route:
    employee_id = resolve_employee_uuid(db, data.EMPLOYEE_ID)
    # ↑ raises HTTPException(404) if neither UUID nor CODE matches.

    # Or pass-through helper that 404s on unknown:
    emp = require_employee(db, data.EMPLOYEE_ID)
"""

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Employee


def resolve_employee_uuid(db: Session, identifier: str) -> str:
    """Return the canonical Employee.ID (UUID) for either a UUID or
    an EMPLOYEE_CODE input. Raises 404 if neither matches.

    Mirrors `assert_self_or_admin`'s identifier-flexibility so the
    pair work together end-to-end: auth accepts both forms, DB
    lookups also accept both forms."""

    if not identifier:
        raise HTTPException(status_code=400, detail="employee_id is required")

    ident = str(identifier).strip()

    # Fast path — exact UUID match
    emp = db.query(Employee).filter(Employee.ID == ident).first()

    if emp:
        return emp.ID

    # Slow path — case-insensitive CODE match
    emp = (
        db.query(Employee)
        .filter(func.upper(Employee.EMPLOYEE_CODE) == ident.upper())
        .first()
    )

    if emp:
        return emp.ID

    raise HTTPException(
        status_code=404,
        detail=f"Employee {identifier} not found"
    )


def require_employee(db: Session, identifier: str) -> Employee:
    """Same lookup, but returns the full Employee row. Saves a second
    fetch when the caller needs the model object."""

    if not identifier:
        raise HTTPException(status_code=400, detail="employee_id is required")

    ident = str(identifier).strip()

    emp = db.query(Employee).filter(Employee.ID == ident).first()

    if emp:
        return emp

    emp = (
        db.query(Employee)
        .filter(func.upper(Employee.EMPLOYEE_CODE) == ident.upper())
        .first()
    )

    if emp:
        return emp

    raise HTTPException(
        status_code=404,
        detail=f"Employee {identifier} not found"
    )
