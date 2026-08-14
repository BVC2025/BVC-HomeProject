"""
RBAC Admin API — Phase 2 security hardening.

Lets an admin with `role.manage` permission read the role/permission
catalogue and grant/revoke permissions per role.

Endpoints
---------
  GET   /rbac/roles                       List roles + grant counts
  GET   /rbac/roles/{role_id}             Single role detail with current grants
  GET   /rbac/permissions                 Full permission catalogue (grouped)
  PATCH /rbac/roles/{role_id}/permissions Replace grants for a role
                                          body: { "codes": ["leave.approve", ...] }
  POST  /rbac/roles/{role_id}/permissions/grant   Add one code
  POST  /rbac/roles/{role_id}/permissions/revoke  Remove one code
"""

from typing import List, Optional
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from datetime import datetime

from app.database.database import get_db
from app.models.models import Role, Permission, RolePermission, Employee
from app.models.rbac_models import EmployeePermissionOverride, EmployeePermissionOverrideAudit
from app.services.permission_catalogue import PAGE_LABELS
from app.auth.auth_bearer import (
    require, get_current_admin, get_current_user,
    assert_not_granting_root_only_codes, assert_role_not_protected,
)


router = APIRouter(prefix="/rbac", tags=["RBAC"])


# =====================================================================
# Serialization helpers
# =====================================================================

def _serialize_role(db: Session, role: Role) -> dict:
    perm_count = (
        db.query(RolePermission)
          .filter(RolePermission.ROLE_ID == role.ID)
          .count()
    )
    member_count = (
        db.query(Employee)
          .filter(Employee.ROLE_ID == role.ID, Employee.STATUS == "ACTIVE")
          .count()
    )
    return {
        "ID":           role.ID,
        "ROLE_NAME":    role.NAME,
        "CODE":         role.CODE,
        "IS_SYSTEM":    bool(role.IS_SYSTEM),
        "permission_count": perm_count,
        "member_count":     member_count,
    }


def _serialize_permission(p: Permission) -> dict:
    return {
        "ID":          p.ID,
        "CODE":        p.CODE,
        "NAME":        p.NAME,
        "CATEGORY":    p.CATEGORY,
        "DESCRIPTION": p.DESCRIPTION,
        "PAGE":        PAGE_LABELS.get(p.CODE),
    }


def _serialize_override(ov: EmployeePermissionOverride, perm: Permission) -> dict:
    return {
        "ID":             ov.ID,
        "PERMISSION_ID":  perm.ID,
        "CODE":           perm.CODE,
        "NAME":           perm.NAME,
        "CATEGORY":       perm.CATEGORY,
        "EFFECT":         ov.EFFECT,
        "GRANTED_BY_ID":  ov.GRANTED_BY_ID,
        "GRANTED_AT":     ov.GRANTED_AT.isoformat() if ov.GRANTED_AT else None,
        "EXPIRES_AT":     ov.EXPIRES_AT.isoformat() if ov.EXPIRES_AT else None,
    }


# =====================================================================
# Schemas
# =====================================================================

class ReplaceGrantsBody(BaseModel):
    codes: List[str] = Field(
        default_factory=list,
        description="The COMPLETE set of permission codes this role should have. "
                    "Codes not in the list are revoked. Unknown codes are rejected."
    )


class SingleCodeBody(BaseModel):
    code: str = Field(..., description="Single permission code")


class OverrideUpsertBody(BaseModel):
    code: str = Field(..., description="Permission code to grant/deny for this employee")
    effect: str = Field(..., description='"GRANT" or "DENY"')
    expires_at: Optional[datetime] = Field(
        None, description="Optional — override reverts to the role default after this time"
    )


# =====================================================================
# READ — visible to anyone with `role.manage`, falls back to legacy admin
# =====================================================================

# Read endpoints are gated on role.manage. We keep get_current_admin as
# fallback so a SUPER_ADMIN who hasn't been re-seeded still works.
_READ_DEP = Depends(require("role.manage"))


@router.get("/roles", dependencies=[_READ_DEP])
def list_roles(db: Session = Depends(get_db)):

    rows = db.query(Role).order_by(Role.NAME).all()
    return [_serialize_role(db, r) for r in rows]


@router.get("/roles/{role_id}", dependencies=[_READ_DEP])
def get_role_detail(role_id: int, db: Session = Depends(get_db)):

    role = db.query(Role).filter(Role.ID == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")

    granted_codes = [
        p.CODE
        for p in db.query(Permission)
                   .join(RolePermission, RolePermission.PERMISSION_ID == Permission.ID)
                   .filter(RolePermission.ROLE_ID == role_id)
                   .all()
    ]

    return {
        **_serialize_role(db, role),
        "granted_codes": sorted(granted_codes),
    }


@router.get("/permissions", dependencies=[_READ_DEP])
def list_permissions(
    grouped: bool = True,
    db: Session = Depends(get_db),
):
    """Full permission catalogue. With grouped=true (default), the
    response is { category: [perms...] }. With grouped=false it's a
    flat list, useful for autocomplete UIs."""

    rows = db.query(Permission).order_by(Permission.CATEGORY, Permission.CODE).all()

    if not grouped:
        return [_serialize_permission(p) for p in rows]

    bucket: dict[str, list[dict]] = defaultdict(list)
    for p in rows:
        cat = p.CATEGORY or "Other"
        bucket[cat].append(_serialize_permission(p))

    return [
        {"category": cat, "permissions": perms}
        for cat, perms in sorted(bucket.items())
    ]


# =====================================================================
# WRITE — strictly gated on role.manage
# =====================================================================

_WRITE_DEP = Depends(require("role.manage"))


@router.patch("/roles/{role_id}/permissions", dependencies=[_WRITE_DEP])
def replace_role_permissions(
    role_id: int,
    body: ReplaceGrantsBody,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """REPLACE the role's permission grants with exactly the supplied
    set. Codes not in the list are revoked. Idempotent."""

    role = db.query(Role).filter(Role.ID == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")

    assert_role_not_protected(role.NAME)
    assert_not_granting_root_only_codes(payload, body.codes)

    # Resolve codes → ids; reject any unknown code so the caller gets
    # a clean 400 instead of a silent no-op.
    requested = list(dict.fromkeys(body.codes))  # de-dupe, preserve order
    perms = db.query(Permission).filter(Permission.CODE.in_(requested)).all()
    found_codes = {p.CODE for p in perms}
    unknown = [c for c in requested if c not in found_codes]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown permission codes: {sorted(unknown)}"
        )
    target_ids = {p.ID for p in perms}

    # Current grants
    current_ids = {
        rp.PERMISSION_ID
        for rp in db.query(RolePermission)
                   .filter(RolePermission.ROLE_ID == role_id)
                   .all()
    }

    to_add    = target_ids - current_ids
    to_remove = current_ids - target_ids

    for pid in to_add:
        db.add(RolePermission(ROLE_ID=role_id, PERMISSION_ID=pid))

    if to_remove:
        (db.query(RolePermission)
           .filter(RolePermission.ROLE_ID == role_id,
                   RolePermission.PERMISSION_ID.in_(to_remove))
           .delete(synchronize_session=False))

    db.commit()

    return {
        "role_id":      role_id,
        "added":        len(to_add),
        "removed":      len(to_remove),
        "total_grants": len(target_ids),
        "note":         "Members must re-login to pick up the new permissions in their JWT.",
    }


@router.post("/roles/{role_id}/permissions/grant", dependencies=[_WRITE_DEP])
def grant_one(
    role_id: int,
    body: SingleCodeBody,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Add a single permission to a role. Idempotent."""

    role = db.query(Role).filter(Role.ID == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")

    assert_role_not_protected(role.NAME)
    assert_not_granting_root_only_codes(payload, [body.code])

    perm = db.query(Permission).filter(Permission.CODE == body.code).first()
    if not perm:
        raise HTTPException(400, f"Unknown permission code: {body.code}")

    existing = (
        db.query(RolePermission)
          .filter(RolePermission.ROLE_ID == role_id,
                  RolePermission.PERMISSION_ID == perm.ID)
          .first()
    )

    if existing:
        return {"role_id": role_id, "code": body.code, "already_granted": True}

    db.add(RolePermission(ROLE_ID=role_id, PERMISSION_ID=perm.ID))
    db.commit()

    return {"role_id": role_id, "code": body.code, "granted": True}


@router.post("/roles/{role_id}/permissions/revoke", dependencies=[_WRITE_DEP])
def revoke_one(
    role_id: int,
    body: SingleCodeBody,
    db: Session = Depends(get_db),
):
    """Remove a single permission from a role. Idempotent."""

    role = db.query(Role).filter(Role.ID == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")

    assert_role_not_protected(role.NAME)

    perm = db.query(Permission).filter(Permission.CODE == body.code).first()
    if not perm:
        raise HTTPException(400, f"Unknown permission code: {body.code}")

    deleted = (
        db.query(RolePermission)
          .filter(RolePermission.ROLE_ID == role_id,
                  RolePermission.PERMISSION_ID == perm.ID)
          .delete(synchronize_session=False)
    )
    db.commit()

    return {"role_id": role_id, "code": body.code, "revoked": bool(deleted)}


# =====================================================================
# EMPLOYEE PERMISSION OVERRIDES — per-employee exceptions on top of
# their role's default grants. Gated on permission.override.manage,
# which is itself in ROOT_ONLY_PERMISSION_CODES — only Root, or a role
# Root has explicitly granted this code to, can reach these endpoints
# (SUPER_ADMIN/ADMIN pass via their existing unconditional bypass in
# require()). Resolution happens at login/refresh time via
# resolve_effective_permissions() in auth_service.py — these writes
# take effect on the employee's next login, not live.
# =====================================================================

_OVERRIDE_DEP = Depends(require("permission.override.manage"))


@router.get("/employees/{employee_id}/overrides", dependencies=[_OVERRIDE_DEP])
def list_employee_overrides(employee_id: str, db: Session = Depends(get_db)):

    employee = db.query(Employee).filter(Employee.ID == employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    rows = (
        db.query(EmployeePermissionOverride, Permission)
          .join(Permission, Permission.ID == EmployeePermissionOverride.PERMISSION_ID)
          .filter(EmployeePermissionOverride.EMPLOYEE_ID == employee_id)
          .all()
    )

    return [_serialize_override(ov, perm) for ov, perm in rows]


@router.post("/employees/{employee_id}/overrides", dependencies=[_OVERRIDE_DEP])
def upsert_employee_override(
    employee_id: str,
    body: OverrideUpsertBody,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    if body.effect not in ("GRANT", "DENY"):
        raise HTTPException(400, 'effect must be "GRANT" or "DENY"')

    employee = db.query(Employee).filter(Employee.ID == employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    # SUPER_ADMIN's access is fixed (unconditional bypass, not
    # grant-based) — an override here would be meaningless and could
    # mislead an admin into thinking it does something.
    if employee.ROLE_ID:
        role_name = (
            db.query(Role.NAME).filter(Role.ID == employee.ROLE_ID).scalar()
        )
        if role_name:
            assert_role_not_protected(role_name)

    perm = db.query(Permission).filter(Permission.CODE == body.code).first()
    if not perm:
        raise HTTPException(400, f"Unknown permission code: {body.code}")

    # An override can never be used to backdoor an RBAC/IAM-category
    # code to a non-Root employee — checked for both GRANT and DENY so
    # there's no asymmetry to accidentally exploit.
    assert_not_granting_root_only_codes(payload, [body.code])

    existing = (
        db.query(EmployeePermissionOverride)
          .filter(
              EmployeePermissionOverride.EMPLOYEE_ID == employee_id,
              EmployeePermissionOverride.PERMISSION_ID == perm.ID,
          )
          .first()
    )

    changed_by = payload.get("employee_id")
    now = datetime.utcnow()

    if existing:
        old_effect = existing.EFFECT
        existing.EFFECT = body.effect
        existing.EXPIRES_AT = body.expires_at
        existing.GRANTED_BY_ID = changed_by
        existing.GRANTED_AT = now
        if old_effect != body.effect:
            db.add(EmployeePermissionOverrideAudit(
                EMPLOYEE_ID=employee_id,
                PERMISSION_ID=perm.ID,
                OLD_EFFECT=old_effect,
                NEW_EFFECT=body.effect,
                REASON=None,
                CHANGED_BY_ID=changed_by,
                VENDOR_ID=employee.VENDOR_ID,
            ))
        row = existing
    else:
        row = EmployeePermissionOverride(
            EMPLOYEE_ID=employee_id,
            PERMISSION_ID=perm.ID,
            EFFECT=body.effect,
            GRANTED_BY_ID=changed_by,
            GRANTED_AT=now,
            EXPIRES_AT=body.expires_at,
            VENDOR_ID=employee.VENDOR_ID,
        )
        db.add(row)
        db.flush()
        db.add(EmployeePermissionOverrideAudit(
            EMPLOYEE_ID=employee_id,
            PERMISSION_ID=perm.ID,
            OLD_EFFECT=None,
            NEW_EFFECT=body.effect,
            REASON=None,
            CHANGED_BY_ID=changed_by,
            VENDOR_ID=employee.VENDOR_ID,
        ))

    db.commit()

    return {
        **_serialize_override(row, perm),
        "note": "The employee must re-login (or refresh their session) to pick up this change.",
    }


@router.delete("/employees/{employee_id}/overrides/{permission_id}", dependencies=[_OVERRIDE_DEP])
def delete_employee_override(
    employee_id: str,
    permission_id: int,
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    row = (
        db.query(EmployeePermissionOverride)
          .filter(
              EmployeePermissionOverride.EMPLOYEE_ID == employee_id,
              EmployeePermissionOverride.PERMISSION_ID == permission_id,
          )
          .first()
    )
    if not row:
        raise HTTPException(404, "No override exists for this employee/permission pair")

    db.add(EmployeePermissionOverrideAudit(
        EMPLOYEE_ID=employee_id,
        PERMISSION_ID=permission_id,
        OLD_EFFECT=row.EFFECT,
        NEW_EFFECT=None,
        REASON=reason,
        CHANGED_BY_ID=payload.get("employee_id"),
        VENDOR_ID=row.VENDOR_ID,
    ))

    db.delete(row)
    db.commit()

    return {
        "employee_id": employee_id,
        "permission_id": permission_id,
        "reverted_to_role_default": True,
        "note": "The employee must re-login (or refresh their session) to pick up this change.",
    }
