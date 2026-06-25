from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, List
import io
import openpyxl

from app.database.database import get_db

from app.models.models import (
    Department,
    Designation,
    Role,
    Permission,
    RolePermission,
    TaskTemplate,
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

from pydantic import BaseModel

class OrgRoleCreate(BaseModel):
    NAME: str
    DEPARTMENT_ID: Optional[int] = None
    DESCRIPTION: Optional[str] = None
    VENDOR_ID: int = 1

class OrgRoleUpdate(BaseModel):
    NAME: Optional[str] = None
    DEPARTMENT_ID: Optional[int] = None
    DESCRIPTION: Optional[str] = None


router = APIRouter()


# =========================
# DEPARTMENTS
# =========================

@router.get("/departments")
def list_departments(
    vendor_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Department)

    if vendor_id is not None:
        q = q.filter(Department.VENDOR_ID == vendor_id)

    if search:
        term = f"%{search}%"
        q = q.filter(
            Department.NAME.ilike(term) | Department.DEPARTMENT_CODE.ilike(term)
        )

    rows = q.order_by(Department.NAME).all()

    return [
        {
            "ID": d.ID,
            "NAME": d.NAME,
            "DEPARTMENT_CODE": d.DEPARTMENT_CODE,
            "DESCRIPTION": d.DESCRIPTION,
            "VENDOR_ID": d.VENDOR_ID,
            "CREATED_AT": d.CREATED_AT.isoformat() if d.CREATED_AT else None,
            "UPDATED_AT": d.UPDATED_AT.isoformat() if d.UPDATED_AT else None
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
        Department.DEPARTMENT_CODE == data.DEPARTMENT_CODE.upper()
    ).first()

    if existing:

        raise HTTPException(
            status_code=400,
            detail=f"Department code '{data.DEPARTMENT_CODE}' already exists for this vendor"
        )

    dept = Department(
        NAME=data.NAME,
        DEPARTMENT_CODE=data.DEPARTMENT_CODE.upper(),
        DESCRIPTION=data.DESCRIPTION,
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

    if data.DEPARTMENT_CODE is not None:
        dept.DEPARTMENT_CODE = data.DEPARTMENT_CODE.upper()

    if data.DESCRIPTION is not None:
        dept.DESCRIPTION = data.DESCRIPTION

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

    rows = q.order_by(Role.NAME).all()

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
            "NAME": r.NAME,
            "DESCRIPTION": r.DESCRIPTION,
            "VENDOR_ID": r.VENDOR_ID,
            "DEPARTMENT_ID": r.DEPARTMENT_ID,
            "PERMISSION_IDS": perm_ids
        })

    return out


@router.post("/roles")
def create_role(
    data: RoleCreate,
    db: Session = Depends(get_db)
):

    role = Role(
        NAME=data.NAME,
        DESCRIPTION=data.DESCRIPTION,
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
            Department.DEPARTMENT_CODE == dept_code
        ).first()

        if not dept:

            dept = Department(
                NAME=dept_name,
                DEPARTMENT_CODE=dept_code,
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
            Role.NAME == role_name
        ).first()

        if not role:

            role = Role(
                NAME=role_name,
                DESCRIPTION=role_desc,
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
            Role.NAME == role_name
        ).first()

        if not role:

            role = Role(
                NAME=role_name,
                DESCRIPTION=role_desc,
                VENDOR_ID=vendor_id
            )

            db.add(role)

            db.flush()

            roles_added += 1

        roles_touched.append(role.NAME)

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


# =========================
# DEPARTMENT BULK UPLOAD
# =========================

def _parse_excel_departments(file_bytes: bytes, sheet_name: Optional[str] = None):
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    sheets = wb.sheetnames
    if sheet_name and sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
    else:
        ws = wb.active
    rows = []
    headers = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c).strip().upper() if c else "" for c in row]
            continue
        if all(c is None for c in row):
            continue
        record = dict(zip(headers, row))
        name = str(record.get("NAME") or "").strip()
        code = str(record.get("CODE") or "").strip()
        desc = str(record.get("DESCRIPTION") or "").strip()
        if name and code:
            rows.append({"NAME": name, "CODE": code, "DESCRIPTION": desc or None})
    return sheets, rows


@router.get("/departments/bulk-upload/template")
def department_upload_template():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Departments"
    ws.append(["NAME", "CODE", "DESCRIPTION"])
    ws.append(["Software Development", "SW", "Software team"])
    ws.append(["Electrical", "ELEC", "Electrical department"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=departments_template.xlsx"}
    )


@router.post("/departments/bulk-upload")
async def bulk_upload_departments(
    vendor_id: int = Query(1),
    sheet_name: Optional[str] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    content = await file.read()
    sheets, rows = _parse_excel_departments(content, sheet_name)

    if not sheet_name and len(sheets) > 1:
        return {"sheets": sheets, "requires_sheet_selection": True}

    created = skipped = 0
    for r in rows:
        exists = db.query(Department).filter(
            Department.VENDOR_ID == vendor_id,
            Department.DEPARTMENT_CODE == r["CODE"].upper()
        ).first()
        if exists:
            skipped += 1
            continue
        db.add(Department(
            NAME=r["NAME"],
            DEPARTMENT_CODE=r["CODE"].upper(),
            DESCRIPTION=r["DESCRIPTION"],
            VENDOR_ID=vendor_id
        ))
        created += 1
    db.commit()
    return {
        "message": f"Upload complete: {created} created, {skipped} skipped",
        "created": created,
        "skipped": skipped,
        "total_rows": len(rows)
    }


# =========================
# ORG ROLES (job-function roles, separate from RBAC)
# =========================

@router.get("/org-roles")
def list_org_roles(
    vendor_id: Optional[int] = Query(None),
    dept_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(Role, Department).outerjoin(
        Department, Role.DEPARTMENT_ID == Department.ID
    )
    if vendor_id is not None:
        q = q.filter(Role.VENDOR_ID == vendor_id)
    if dept_id is not None:
        q = q.filter(Role.DEPARTMENT_ID == dept_id)
    if search:
        term = f"%{search}%"
        q = q.filter(Role.NAME.ilike(term))
    rows = q.order_by(Role.NAME).all()
    return [
        {
            "ID": r.ID,
            "NAME": r.NAME,
            "DESCRIPTION": r.DESCRIPTION,
            "DEPARTMENT_ID": r.DEPARTMENT_ID,
            "DEPARTMENT_NAME": d.NAME if d else None,
            "VENDOR_ID": r.VENDOR_ID
        }
        for r, d in rows
    ]


@router.post("/org-roles")
def create_org_role(
    data: OrgRoleCreate,
    db: Session = Depends(get_db)
):
    existing = db.query(Role).filter(
        Role.VENDOR_ID == data.VENDOR_ID,
        Role.NAME == data.NAME
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Role '{data.NAME}' already exists")
    role = Role(
        NAME=data.NAME,
        DESCRIPTION=data.DESCRIPTION,
        DEPARTMENT_ID=data.DEPARTMENT_ID,
        VENDOR_ID=data.VENDOR_ID
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return {"message": "Role created", "ID": role.ID}


@router.put("/org-roles/{role_id}")
def update_org_role(
    role_id: int,
    data: OrgRoleUpdate,
    db: Session = Depends(get_db)
):
    role = db.query(Role).filter(Role.ID == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if data.NAME is not None:
        role.NAME = data.NAME
    if data.DEPARTMENT_ID is not None:
        role.DEPARTMENT_ID = data.DEPARTMENT_ID
    if data.DESCRIPTION is not None:
        role.DESCRIPTION = data.DESCRIPTION
    db.commit()
    return {"message": "Role updated"}


@router.delete("/org-roles/{role_id}")
def delete_org_role(
    role_id: int,
    db: Session = Depends(get_db)
):
    role = db.query(Role).filter(Role.ID == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    in_use = db.query(TaskTemplate).filter(TaskTemplate.ROLE_ID == role_id).first()
    if in_use:
        raise HTTPException(
            status_code=400,
            detail="Role is referenced by task templates. Remove those references first."
        )
    db.delete(role)
    db.commit()
    return {"message": "Role deleted"}


@router.get("/org-roles/bulk-upload/template")
def org_role_upload_template():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Roles"
    ws.append(["ROLE_NAME", "DEPARTMENT_NAME", "DESCRIPTION"])
    ws.append(["PLC Engineer", "Electrical", "PLC programming specialist"])
    ws.append(["Fitter", "Assembly", "Mechanical assembly fitter"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=roles_template.xlsx"}
    )


@router.post("/org-roles/bulk-upload")
async def bulk_upload_org_roles(
    vendor_id: int = Query(1),
    sheet_name: Optional[str] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    content = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    sheets = wb.sheetnames

    if not sheet_name and len(sheets) > 1:
        return {"sheets": sheets, "requires_sheet_selection": True}

    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
    headers = []
    parsed = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c).strip().upper() if c else "" for c in row]
            continue
        if all(c is None for c in row):
            continue
        record = dict(zip(headers, row))
        role_name = str(record.get("ROLE_NAME") or "").strip()
        dept_name = str(record.get("DEPARTMENT_NAME") or "").strip()
        desc = str(record.get("DESCRIPTION") or "").strip()
        if role_name:
            parsed.append({"ROLE_NAME": role_name, "DEPT_NAME": dept_name, "DESCRIPTION": desc or None})

    created = skipped = 0
    for r in parsed:
        dept_id = None
        if r["DEPT_NAME"]:
            dept = db.query(Department).filter(
                Department.VENDOR_ID == vendor_id,
                Department.NAME.ilike(r["DEPT_NAME"])
            ).first()
            if dept:
                dept_id = dept.ID
        exists = db.query(Role).filter(
            Role.VENDOR_ID == vendor_id,
            Role.NAME == r["ROLE_NAME"]
        ).first()
        if exists:
            skipped += 1
            continue
        db.add(Role(
            NAME=r["ROLE_NAME"],
            DESCRIPTION=r["DESCRIPTION"],
            DEPARTMENT_ID=dept_id,
            VENDOR_ID=vendor_id
        ))
        created += 1
    db.commit()
    return {
        "message": f"Upload complete: {created} created, {skipped} skipped",
        "created": created,
        "skipped": skipped,
        "total_rows": len(parsed)
    }
