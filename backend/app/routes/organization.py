from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from app.database.database import get_db

from app.models.models import (
    Department,
    Designation,
    Role,
    Permission,
    RolePermission,
    Vendor
)

from app.schemas.org_schema import (
    DepartmentCreate,
    DepartmentUpdate,
    DesignationCreate,
    DesignationUpdate,
    RoleCreate,
    RolePermissionsSet
)

from app.services.seed_data import (
    ORG_PRESETS,
    PERMISSIONS_CATALOG,
    STANDARD_ROLES
)


router = APIRouter()


# =========================
# DEPARTMENTS
# =========================

@router.get("/departments")
def list_departments(
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Department)

    if vendor_id is not None:

        q = q.filter(Department.VENDOR_ID == vendor_id)

    rows = q.order_by(Department.NAME).all()

    return [
        {
            "ID": d.ID,
            "NAME": d.NAME,
            "CODE": d.CODE,
            "DESCRIPTION": d.DESCRIPTION,
            "HEAD_EMPLOYEE_ID": d.HEAD_EMPLOYEE_ID,
            "VENDOR_ID": d.VENDOR_ID
        }
        for d in rows
    ]


@router.post("/departments")
def create_department(
    data: DepartmentCreate,
    db: Session = Depends(get_db)
):

    existing = db.query(Department).filter(
        Department.VENDOR_ID == data.VENDOR_ID,
        Department.CODE == data.CODE.upper()
    ).first()

    if existing:

        raise HTTPException(
            status_code=400,
            detail=f"Department code '{data.CODE}' already exists for this vendor"
        )

    dept = Department(
        NAME=data.NAME,
        CODE=data.CODE.upper(),
        DESCRIPTION=data.DESCRIPTION,
        HEAD_EMPLOYEE_ID=data.HEAD_EMPLOYEE_ID,
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(dept)

    db.commit()

    db.refresh(dept)

    return {"message": "Department created", "ID": dept.ID}


@router.put("/departments/{dept_id}")
def update_department(
    dept_id: int,
    data: DepartmentUpdate,
    db: Session = Depends(get_db)
):

    dept = db.query(Department).filter(
        Department.ID == dept_id
    ).first()

    if not dept:

        raise HTTPException(status_code=404, detail="Department not found")

    if data.NAME is not None:
        dept.NAME = data.NAME

    if data.CODE is not None:
        dept.CODE = data.CODE.upper()

    if data.DESCRIPTION is not None:
        dept.DESCRIPTION = data.DESCRIPTION

    if data.HEAD_EMPLOYEE_ID is not None:
        dept.HEAD_EMPLOYEE_ID = data.HEAD_EMPLOYEE_ID

    db.commit()

    return {"message": "Department updated"}


@router.delete("/departments/{dept_id}")
def delete_department(
    dept_id: int,
    db: Session = Depends(get_db)
):

    dept = db.query(Department).filter(
        Department.ID == dept_id
    ).first()

    if not dept:

        raise HTTPException(status_code=404, detail="Department not found")

    in_use = db.query(Designation).filter(
        Designation.DEPARTMENT_ID == dept_id
    ).first()

    if in_use:

        raise HTTPException(
            status_code=400,
            detail="Department has designations. Delete them first."
        )

    db.delete(dept)

    db.commit()

    return {"message": "Department deleted"}


# =========================
# DESIGNATIONS
# =========================

@router.get("/designations")
def list_designations(
    department_id: Optional[int] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Designation, Department).join(
        Department,
        Designation.DEPARTMENT_ID == Department.ID
    )

    if department_id is not None:

        q = q.filter(Designation.DEPARTMENT_ID == department_id)

    if vendor_id is not None:

        q = q.filter(Designation.VENDOR_ID == vendor_id)

    rows = q.order_by(Department.NAME, Designation.TITLE).all()

    return [
        {
            "ID": des.ID,
            "TITLE": des.TITLE,
            "DEPARTMENT_ID": des.DEPARTMENT_ID,
            "DEPARTMENT_NAME": dept.NAME,
            "BASE_SALARY": des.BASE_SALARY,
            "DESCRIPTION": des.DESCRIPTION,
            "VENDOR_ID": des.VENDOR_ID
        }
        for des, dept in rows
    ]


@router.post("/designations")
def create_designation(
    data: DesignationCreate,
    db: Session = Depends(get_db)
):

    dept = db.query(Department).filter(
        Department.ID == data.DEPARTMENT_ID
    ).first()

    if not dept:

        raise HTTPException(
            status_code=400,
            detail="Department not found"
        )

    des = Designation(
        TITLE=data.TITLE,
        DEPARTMENT_ID=data.DEPARTMENT_ID,
        BASE_SALARY=data.BASE_SALARY,
        DESCRIPTION=data.DESCRIPTION,
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(des)

    db.commit()

    db.refresh(des)

    return {"message": "Designation created", "ID": des.ID}


@router.put("/designations/{des_id}")
def update_designation(
    des_id: int,
    data: DesignationUpdate,
    db: Session = Depends(get_db)
):

    des = db.query(Designation).filter(
        Designation.ID == des_id
    ).first()

    if not des:

        raise HTTPException(status_code=404, detail="Designation not found")

    if data.TITLE is not None:
        des.TITLE = data.TITLE

    if data.DEPARTMENT_ID is not None:
        des.DEPARTMENT_ID = data.DEPARTMENT_ID

    if data.BASE_SALARY is not None:
        des.BASE_SALARY = data.BASE_SALARY

    if data.DESCRIPTION is not None:
        des.DESCRIPTION = data.DESCRIPTION

    db.commit()

    return {"message": "Designation updated"}


@router.delete("/designations/{des_id}")
def delete_designation(
    des_id: int,
    db: Session = Depends(get_db)
):

    des = db.query(Designation).filter(
        Designation.ID == des_id
    ).first()

    if not des:

        raise HTTPException(status_code=404, detail="Designation not found")

    db.delete(des)

    db.commit()

    return {"message": "Designation deleted"}


# =========================
# PERMISSIONS (read-only)
# =========================

@router.get("/permissions")
def list_permissions(
    db: Session = Depends(get_db)
):

    rows = db.query(Permission).order_by(
        Permission.CATEGORY,
        Permission.CODE
    ).all()

    return [
        {
            "ID": p.ID,
            "CODE": p.CODE,
            "NAME": p.NAME,
            "CATEGORY": p.CATEGORY,
            "DESCRIPTION": p.DESCRIPTION
        }
        for p in rows
    ]


# =========================
# ROLES (per-vendor)
# =========================

@router.get("/roles")
def list_roles(
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Role)

    if vendor_id is not None:

        q = q.filter(Role.VENDOR_ID == vendor_id)

    rows = q.order_by(Role.ROLE_NAME).all()

    out = []

    for r in rows:

        perm_ids = [
            rp.PERMISSION_ID
            for rp in db.query(RolePermission).filter(
                RolePermission.ROLE_ID == r.ID
            ).all()
        ]

        out.append({
            "ID": r.ID,
            "ROLE_NAME": r.ROLE_NAME,
            "DESCRIPTION": r.DESCRIPTION,
            "IS_SYSTEM": bool(r.IS_SYSTEM),
            "VENDOR_ID": r.VENDOR_ID,
            "PERMISSION_IDS": perm_ids
        })

    return out


@router.post("/roles")
def create_role(
    data: RoleCreate,
    db: Session = Depends(get_db)
):

    role = Role(
        ROLE_NAME=data.ROLE_NAME,
        DESCRIPTION=data.DESCRIPTION,
        IS_SYSTEM=0,
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(role)

    db.commit()

    db.refresh(role)

    return {"message": "Role created", "ID": role.ID}


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    db: Session = Depends(get_db)
):

    role = db.query(Role).filter(Role.ID == role_id).first()

    if not role:

        raise HTTPException(status_code=404, detail="Role not found")

    if role.IS_SYSTEM:

        raise HTTPException(
            status_code=400,
            detail="System roles cannot be deleted"
        )

    db.query(RolePermission).filter(
        RolePermission.ROLE_ID == role_id
    ).delete()

    db.delete(role)

    db.commit()

    return {"message": "Role deleted"}


@router.put("/roles/{role_id}/permissions")
def set_role_permissions(
    role_id: int,
    data: RolePermissionsSet,
    db: Session = Depends(get_db)
):

    role = db.query(Role).filter(Role.ID == role_id).first()

    if not role:

        raise HTTPException(status_code=404, detail="Role not found")

    # Wipe existing, replace with the new set
    db.query(RolePermission).filter(
        RolePermission.ROLE_ID == role_id
    ).delete()

    for pid in data.PERMISSION_IDS:

        db.add(RolePermission(
            ROLE_ID=role_id,
            PERMISSION_ID=pid
        ))

    db.commit()

    return {
        "message": "Role permissions updated",
        "count": len(data.PERMISSION_IDS)
    }


# =========================
# SEED — Org skeleton
# =========================

def do_seed_org(db: Session, preset_key: str, vendor_id: int) -> dict:
    """Idempotent core of org seeding — callable from both the
    /seed-org endpoint and from main.py startup."""

    preset_key = preset_key.upper()

    if preset_key not in ORG_PRESETS:

        raise ValueError(
            f"Unknown preset '{preset_key}'. "
            f"Available: {list(ORG_PRESETS.keys())}"
        )

    vendor = db.query(Vendor).filter(Vendor.ID == vendor_id).first()

    if not vendor:

        vendor = Vendor(ID=vendor_id, VENDOR_NAME="Bharath Vending Corporation")

        db.add(vendor)

        db.commit()

    # ---- 1. Permissions (global) ----
    perms_added = 0

    code_to_perm = {}

    for code, name, category, desc in PERMISSIONS_CATALOG:

        existing = db.query(Permission).filter(
            Permission.CODE == code
        ).first()

        if existing:

            code_to_perm[code] = existing

            continue

        p = Permission(
            CODE=code,
            NAME=name,
            CATEGORY=category,
            DESCRIPTION=desc
        )

        db.add(p)

        db.flush()

        code_to_perm[code] = p

        perms_added += 1

    db.commit()

    all_perm_ids = [p.ID for p in code_to_perm.values()]

    # ---- 2. Departments + designations ----
    depts_added = 0

    designations_added = 0

    for dept_name, dept_code, designations in ORG_PRESETS[preset_key]["departments"]:

        dept = db.query(Department).filter(
            Department.VENDOR_ID == vendor_id,
            Department.CODE == dept_code
        ).first()

        if not dept:

            dept = Department(
                NAME=dept_name,
                CODE=dept_code,
                VENDOR_ID=vendor_id
            )

            db.add(dept)

            db.flush()

            depts_added += 1

        for title, salary in designations:

            existing_des = db.query(Designation).filter(
                Designation.VENDOR_ID == vendor_id,
                Designation.DEPARTMENT_ID == dept.ID,
                Designation.TITLE == title
            ).first()

            if existing_des:

                continue

            db.add(Designation(
                TITLE=title,
                DEPARTMENT_ID=dept.ID,
                BASE_SALARY=salary,
                VENDOR_ID=vendor_id
            ))

            designations_added += 1

    db.commit()

    # ---- 3. Standard roles + permission assignments ----
    roles_added = 0

    for role_name, role_desc, perm_codes in STANDARD_ROLES:

        role = db.query(Role).filter(
            Role.VENDOR_ID == vendor_id,
            Role.ROLE_NAME == role_name
        ).first()

        if not role:

            role = Role(
                ROLE_NAME=role_name,
                DESCRIPTION=role_desc,
                IS_SYSTEM=1,
                VENDOR_ID=vendor_id
            )

            db.add(role)

            db.flush()

            roles_added += 1

        if perm_codes == "*":

            target_ids = set(all_perm_ids)

        else:

            target_ids = {
                code_to_perm[c].ID
                for c in perm_codes
                if c in code_to_perm
            }

        current_ids = {
            rp.PERMISSION_ID
            for rp in db.query(RolePermission).filter(
                RolePermission.ROLE_ID == role.ID
            ).all()
        }

        for pid in target_ids - current_ids:

            db.add(RolePermission(
                ROLE_ID=role.ID,
                PERMISSION_ID=pid
            ))

    db.commit()

    return {
        "preset": preset_key,
        "vendor_id": vendor_id,
        "permissions_added": perms_added,
        "departments_added": depts_added,
        "designations_added": designations_added,
        "roles_added": roles_added,
        "total_permissions": len(all_perm_ids)
    }


@router.post("/seed-org")
def seed_org(
    preset: str = Query("MANUFACTURING"),
    vendor_id: int = Query(1),
    db: Session = Depends(get_db)
):
    """
    Idempotent seed:
      1. Permissions catalog (global) — only adds missing codes.
      2. Departments + designations for `vendor_id` from the chosen preset.
      3. Standard roles for `vendor_id` with their permission assignments.

    Safe to re-run; existing rows are not overwritten.
    """

    try:

        result = do_seed_org(db, preset, vendor_id)

    except ValueError as exc:

        raise HTTPException(status_code=400, detail=str(exc))

    return {"message": f"Seeded {result['preset']} org structure", **result}


@router.get("/org-presets")
def list_presets():

    return [
        {"key": k, "label": v["label"]}
        for k, v in ORG_PRESETS.items()
    ]


# =========================
# Admin Module 2 — BVC24 9-role catalogue
# =========================

@router.post("/roles/seed-bvc24-catalogue")
def seed_bvc24_role_catalogue(
    vendor_id: int = Query(1),
    db: Session = Depends(get_db)
):
    """Idempotently seed/refresh the BVC24 9-role catalogue (Phase 2
    of Admin Module). Touches only permissions + roles + role_permission
    — leaves departments and designations alone.

    Safe to re-run at any time. Existing role-permission assignments
    are not removed; only missing ones are added (so admin can still
    customise a seeded role afterwards without losing the override on
    the next call)."""

    perms_added = 0

    code_to_perm = {}

    # ---- 1. Permission catalog (global, vendor_id ignored) ----
    for code, name, category, desc in PERMISSIONS_CATALOG:

        existing = db.query(Permission).filter(
            Permission.CODE == code
        ).first()

        if existing:

            code_to_perm[code] = existing

            continue

        p = Permission(
            CODE=code,
            NAME=name,
            CATEGORY=category,
            DESCRIPTION=desc
        )

        db.add(p)

        db.flush()

        code_to_perm[code] = p

        perms_added += 1

    all_perm_ids = [p.ID for p in code_to_perm.values()]

    # ---- 2. Roles + role-permission rows (per-vendor) ----
    roles_added = 0

    roles_touched = []

    for role_name, role_desc, perm_codes in STANDARD_ROLES:

        role = db.query(Role).filter(
            Role.VENDOR_ID == vendor_id,
            Role.ROLE_NAME == role_name
        ).first()

        if not role:

            role = Role(
                ROLE_NAME=role_name,
                DESCRIPTION=role_desc,
                IS_SYSTEM=1,
                VENDOR_ID=vendor_id
            )

            db.add(role)

            db.flush()

            roles_added += 1

        roles_touched.append(role.ROLE_NAME)

        if perm_codes == "*":

            target_ids = set(all_perm_ids)

        else:

            target_ids = {
                code_to_perm[c].ID
                for c in perm_codes
                if c in code_to_perm
            }

        current_ids = {
            rp.PERMISSION_ID
            for rp in db.query(RolePermission).filter(
                RolePermission.ROLE_ID == role.ID
            ).all()
        }

        for pid in target_ids - current_ids:

            db.add(RolePermission(
                ROLE_ID=role.ID,
                PERMISSION_ID=pid
            ))

    db.commit()

    return {
        "message": (
            f"Catalogue synced. {roles_added} new role(s), "
            f"{perms_added} new permission code(s). "
            f"Total roles in catalogue: {len(roles_touched)}."
        ),
        "vendor_id": vendor_id,
        "permissions_added": perms_added,
        "roles_added": roles_added,
        "roles": roles_touched,
        "bvc24_target_roles": [
            "SUPER_ADMIN", "MANAGING_DIRECTOR", "HR_MANAGER",
            "SALES_MANAGER", "PURCHASE_MANAGER", "PRODUCTION_MANAGER",
            "INVENTORY_MANAGER", "ACCOUNTS_MANAGER", "EMPLOYEE",
        ]
    }
