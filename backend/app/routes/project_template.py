from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
import io
import csv
import openpyxl

from app.database.database import get_db

from app.models.models import (
    ProjectCategory,
    Project,
    TaskTemplate,
    Department,
    Role,
    CustomField,
    CustomFieldTableValue,
)


router = APIRouter()


# =========================
# SCHEMAS
# =========================

class CategoryCreate(BaseModel):
    NAME: str
    DESCRIPTION: Optional[str] = None
    VENDOR_ID: int = 1


class CategoryUpdate(BaseModel):
    NAME: Optional[str] = None
    DESCRIPTION: Optional[str] = None


class TaskTemplateIn(BaseModel):
    NAME: str
    DESCRIPTION: Optional[str] = None
    DURATION_VALUE: float = 1.0
    DURATION_UNIT: str = "DAYS"
    SEQUENCE_NUMBER: int = 0
    DEPARTMENT_ID: Optional[int] = None
    ROLE_ID: Optional[int] = None


class ProjectCreate(BaseModel):
    CATEGORY_ID: str
    NAME: str
    DESCRIPTION: Optional[str] = None
    BOM_MODE: Optional[str] = None
    VENDOR_ID: int = 1
    tasks: Optional[List[TaskTemplateIn]] = []


class ProjectUpdate(BaseModel):
    NAME: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    BOM_MODE: Optional[str] = None
    CATEGORY_ID: Optional[str] = None
    tasks: Optional[List[TaskTemplateIn]] = None
    VENDOR_ID: int = 1


class TaskTemplateCreate(BaseModel):
    PROJECT_ID: str
    NAME: str
    DESCRIPTION: Optional[str] = None
    DURATION_VALUE: float = 1.0
    DURATION_UNIT: str = "DAYS"
    SEQUENCE_NUMBER: int = 0
    DEPARTMENT_ID: Optional[int] = None
    ROLE_ID: Optional[int] = None
    VENDOR_ID: int = 1


class TaskTemplateUpdate(BaseModel):
    NAME: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    DURATION_VALUE: Optional[float] = None
    DURATION_UNIT: Optional[str] = None
    SEQUENCE_NUMBER: Optional[int] = None
    DEPARTMENT_ID: Optional[int] = None
    ROLE_ID: Optional[int] = None


class ReorderItem(BaseModel):
    id: str
    sequence_number: int


# =========================
# DURATION HELPERS
# =========================

_UNIT_TO_DAYS = {
    "HOURS":  1.0 / 8.0,
    "DAYS":   1.0,
    "WEEKS":  5.0,
    "MONTHS": 22.0,
    "YEARS":  260.0,
}


def _to_days(value: float, unit: str) -> float:
    return float(value) * _UNIT_TO_DAYS.get(unit.upper(), 1.0)


def _recalc_project_duration(project: Project, db: Session):
    """Re-sum all task durations and write to ESTIMATED_TOTAL_DAYS."""
    tasks = db.query(TaskTemplate).filter(TaskTemplate.PROJECT_ID == project.ID).all()
    total = sum(_to_days(float(t.DURATION_VALUE), t.DURATION_UNIT) for t in tasks)
    project.ESTIMATED_TOTAL_DAYS = round(total, 2)
    db.flush()


# =========================
# TASK HELPERS
# =========================

def _task_to_dict(t: TaskTemplate, dept_name=None, role_name=None):
    return {
        "ID": t.ID,
        "PROJECT_ID": t.PROJECT_ID,
        "NAME": t.NAME,
        "DESCRIPTION": t.DESCRIPTION,
        "DURATION_VALUE": float(t.DURATION_VALUE) if t.DURATION_VALUE is not None else 1.0,
        "DURATION_UNIT": t.DURATION_UNIT,
        "SEQUENCE_NUMBER": t.SEQUENCE_NUMBER,
        "DEPARTMENT_ID": t.DEPARTMENT_ID,
        "DEPARTMENT_NAME": dept_name,
        "ROLE_ID": t.ROLE_ID,
        "ROLE_NAME": role_name,
        "VENDOR_ID": t.VENDOR_ID,
        "CREATED_AT": t.CREATED_AT.isoformat() if t.CREATED_AT else None,
        "UPDATED_AT": t.UPDATED_AT.isoformat() if t.UPDATED_AT else None
    }


def _enrich_tasks(tasks, db):
    result = []
    for t in tasks:
        dept_name = None
        role_name = None
        if t.DEPARTMENT_ID:
            d = db.query(Department).filter(Department.ID == t.DEPARTMENT_ID).first()
            if d:
                dept_name = d.NAME
        if t.ROLE_ID:
            r = db.query(Role).filter(Role.ID == t.ROLE_ID).first()
            if r:
                role_name = r.NAME
        result.append(_task_to_dict(t, dept_name, role_name))
    return result


# =========================
# PROJECT CATEGORIES
# =========================

@router.get("/project-categories")
def list_categories(
    vendor_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(ProjectCategory)
    if vendor_id is not None:
        q = q.filter(ProjectCategory.VENDOR_ID == vendor_id)
    if search:
        term = f"%{search}%"
        q = q.filter(ProjectCategory.NAME.ilike(term))
    rows = q.order_by(ProjectCategory.NAME).all()
    return [
        {
            "ID": c.ID,
            "NAME": c.NAME,
            "DESCRIPTION": c.DESCRIPTION,
            "VENDOR_ID": c.VENDOR_ID,
            "PROJECT_COUNT": len(c.projects),
            "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None,
            "UPDATED_AT": c.UPDATED_AT.isoformat() if c.UPDATED_AT else None
        }
        for c in rows
    ]


@router.get("/project-categories/{category_id}")
def get_category(category_id: str, db: Session = Depends(get_db)):
    c = db.query(ProjectCategory).filter(ProjectCategory.ID == category_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Category not found")
    return {
        "ID": c.ID,
        "NAME": c.NAME,
        "DESCRIPTION": c.DESCRIPTION,
        "VENDOR_ID": c.VENDOR_ID,
        "PROJECT_COUNT": len(c.projects),
        "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None,
        "UPDATED_AT": c.UPDATED_AT.isoformat() if c.UPDATED_AT else None
    }


@router.post("/project-categories")
def create_category(data: CategoryCreate, db: Session = Depends(get_db)):
    existing = db.query(ProjectCategory).filter(
        ProjectCategory.VENDOR_ID == data.VENDOR_ID,
        ProjectCategory.NAME == data.NAME
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Category '{data.NAME}' already exists")
    cat = ProjectCategory(
        NAME=data.NAME,
        DESCRIPTION=data.DESCRIPTION,
        VENDOR_ID=data.VENDOR_ID
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return {"message": "Category created", "ID": cat.ID}


@router.put("/project-categories/{category_id}")
def update_category(category_id: str, data: CategoryUpdate, db: Session = Depends(get_db)):
    cat = db.query(ProjectCategory).filter(ProjectCategory.ID == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if data.NAME is not None:
        cat.NAME = data.NAME
    if data.DESCRIPTION is not None:
        cat.DESCRIPTION = data.DESCRIPTION
    db.commit()
    return {"message": "Category updated"}


@router.delete("/project-categories/{category_id}")
def delete_category(category_id: str, db: Session = Depends(get_db)):
    cat = db.query(ProjectCategory).filter(ProjectCategory.ID == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if cat.projects:
        raise HTTPException(
            status_code=400,
            detail="Category has projects. Delete them first."
        )
    db.query(CustomFieldTableValue).filter(
        CustomFieldTableValue.TABLE_NAME == "project_category",
        CustomFieldTableValue.TABLE_ROW_ID == str(category_id),
    ).delete(synchronize_session=False)
    db.delete(cat)
    db.commit()
    return {"message": "Category deleted"}


# =========================
# PROJECTS (formerly SubProjectTemplates)
# =========================

@router.get("/projects")
def list_projects(
    category_id: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(Project, ProjectCategory).join(
        ProjectCategory, Project.CATEGORY_ID == ProjectCategory.ID
    )
    if vendor_id is not None:
        q = q.filter(Project.VENDOR_ID == vendor_id)
    if category_id:
        q = q.filter(Project.CATEGORY_ID == category_id)
    if search:
        term = f"%{search}%"
        q = q.filter(Project.NAME.ilike(term))
    rows = q.order_by(Project.NAME).all()
    return [
        {
            "ID": p.ID,
            "NAME": p.NAME,
            "DESCRIPTION": p.DESCRIPTION,
            "CATEGORY_ID": p.CATEGORY_ID,
            "CATEGORY_NAME": c.NAME,
            "BOM_MODE": p.BOM_MODE,
            "ESTIMATED_TOTAL_DAYS": float(p.ESTIMATED_TOTAL_DAYS) if p.ESTIMATED_TOTAL_DAYS else 0.0,
            "TASK_COUNT": len(p.task_templates),
            "VENDOR_ID": p.VENDOR_ID,
            "CREATED_AT": p.CREATED_AT.isoformat() if p.CREATED_AT else None,
            "UPDATED_AT": p.UPDATED_AT.isoformat() if p.UPDATED_AT else None
        }
        for p, c in rows
    ]


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.ID == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    cat = db.query(ProjectCategory).filter(ProjectCategory.ID == p.CATEGORY_ID).first()
    tasks = _enrich_tasks(
        db.query(TaskTemplate)
            .filter(TaskTemplate.PROJECT_ID == project_id)
            .order_by(TaskTemplate.SEQUENCE_NUMBER)
            .all(),
        db
    )
    return {
        "ID": p.ID,
        "NAME": p.NAME,
        "DESCRIPTION": p.DESCRIPTION,
        "CATEGORY_ID": p.CATEGORY_ID,
        "CATEGORY_NAME": cat.NAME if cat else None,
        "BOM_MODE": p.BOM_MODE,
        "ESTIMATED_TOTAL_DAYS": float(p.ESTIMATED_TOTAL_DAYS) if p.ESTIMATED_TOTAL_DAYS else 0.0,
        "VENDOR_ID": p.VENDOR_ID,
        "CREATED_AT": p.CREATED_AT.isoformat() if p.CREATED_AT else None,
        "UPDATED_AT": p.UPDATED_AT.isoformat() if p.UPDATED_AT else None,
        "tasks": tasks
    }


@router.post("/projects")
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    cat = db.query(ProjectCategory).filter(ProjectCategory.ID == data.CATEGORY_ID).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    existing = db.query(Project).filter(
        Project.VENDOR_ID == data.VENDOR_ID,
        Project.CATEGORY_ID == data.CATEGORY_ID,
        Project.NAME == data.NAME
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Project '{data.NAME}' already exists in this category")

    project = Project(
        CATEGORY_ID=data.CATEGORY_ID,
        NAME=data.NAME,
        DESCRIPTION=data.DESCRIPTION,
        BOM_MODE=data.BOM_MODE,
        ESTIMATED_TOTAL_DAYS=0.0,
        VENDOR_ID=data.VENDOR_ID
    )
    db.add(project)
    db.flush()

    if data.tasks:
        for i, t in enumerate(data.tasks):
            task = TaskTemplate(
                PROJECT_ID=project.ID,
                NAME=t.NAME,
                DESCRIPTION=t.DESCRIPTION,
                DURATION_VALUE=t.DURATION_VALUE,
                DURATION_UNIT=t.DURATION_UNIT,
                SEQUENCE_NUMBER=t.SEQUENCE_NUMBER if t.SEQUENCE_NUMBER else i,
                DEPARTMENT_ID=t.DEPARTMENT_ID,
                ROLE_ID=t.ROLE_ID,
                VENDOR_ID=data.VENDOR_ID
            )
            db.add(task)
        db.flush()
        _recalc_project_duration(project, db)

    db.commit()
    db.refresh(project)
    return {"message": "Project created", "ID": project.ID}


@router.put("/projects/{project_id}")
def update_project(project_id: str, data: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.ID == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if data.NAME is not None:
        project.NAME = data.NAME
    if data.DESCRIPTION is not None:
        project.DESCRIPTION = data.DESCRIPTION
    if data.BOM_MODE is not None:
        project.BOM_MODE = data.BOM_MODE
    if data.CATEGORY_ID is not None:
        cat = db.query(ProjectCategory).filter(ProjectCategory.ID == data.CATEGORY_ID).first()
        if not cat:
            raise HTTPException(status_code=404, detail="Category not found")
        project.CATEGORY_ID = data.CATEGORY_ID
    if data.tasks is not None:
        db.query(TaskTemplate).filter(TaskTemplate.PROJECT_ID == project_id).delete()
        for i, t in enumerate(data.tasks):
            task = TaskTemplate(
                PROJECT_ID=project_id,
                NAME=t.NAME,
                DESCRIPTION=t.DESCRIPTION,
                DURATION_VALUE=t.DURATION_VALUE,
                DURATION_UNIT=t.DURATION_UNIT,
                SEQUENCE_NUMBER=t.SEQUENCE_NUMBER if t.SEQUENCE_NUMBER else i,
                DEPARTMENT_ID=t.DEPARTMENT_ID,
                ROLE_ID=t.ROLE_ID,
                VENDOR_ID=data.VENDOR_ID
            )
            db.add(task)
        db.flush()
        _recalc_project_duration(project, db)
    db.commit()
    return {"message": "Project updated"}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.ID == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Clean up task template CF values before cascade deletes the tasks
    task_ids = [str(row[0]) for row in db.query(TaskTemplate.ID).filter(TaskTemplate.PROJECT_ID == project_id).all()]
    if task_ids:
        db.query(CustomFieldTableValue).filter(
            CustomFieldTableValue.TABLE_NAME == "task_template",
            CustomFieldTableValue.TABLE_ROW_ID.in_(task_ids),
        ).delete(synchronize_session=False)
    db.query(CustomFieldTableValue).filter(
        CustomFieldTableValue.TABLE_NAME == "project",
        CustomFieldTableValue.TABLE_ROW_ID == str(project_id),
    ).delete(synchronize_session=False)
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}


# =========================
# BOM PARSE
# =========================

@router.post("/projects/parse-bom")
async def parse_bom(
    file: UploadFile = File(...),
    sheet_name: Optional[str] = Query(None),
):
    content = await file.read()
    filename = file.filename or ""

    if filename.lower().endswith(".csv"):
        text = content.decode("utf-8", errors="ignore")
        reader = csv.DictReader(io.StringIO(text))
        rows_raw = list(reader)
        name_col = next(
            (c for c in (rows_raw[0].keys() if rows_raw else [])
             if c.strip().upper() in ("ASSEMBLY", "NAME", "ITEM", "PART NAME", "DESCRIPTION")),
            None
        )
        rows = [
            {"name": str(r.get(name_col, "")).strip(), "sequence": i}
            for i, r in enumerate(rows_raw, 1)
            if str(r.get(name_col, "")).strip()
        ]
        return {"sheets": None, "rows": rows}

    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    sheets = wb.sheetnames

    if not sheet_name and len(sheets) > 1:
        return {"sheets": sheets, "rows": []}

    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
    headers = []
    rows = []
    name_col_idx = None
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c).strip().upper() if c else "" for c in row]
            for idx, h in enumerate(headers):
                if h in ("ASSEMBLY", "NAME", "ITEM", "PART NAME", "DESCRIPTION"):
                    name_col_idx = idx
                    break
            if name_col_idx is None and headers:
                name_col_idx = 0
            continue
        if all(c is None for c in row):
            continue
        if name_col_idx is not None and name_col_idx < len(row):
            val = str(row[name_col_idx]).strip() if row[name_col_idx] else ""
            if val:
                rows.append({"name": val, "sequence": len(rows)})
    return {"sheets": sheets, "rows": rows}


# =========================
# TASK TEMPLATES
# =========================

@router.get("/task-templates")
def list_task_templates(
    project_id: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(TaskTemplate)
    if project_id:
        q = q.filter(TaskTemplate.PROJECT_ID == project_id)
    if vendor_id is not None:
        q = q.filter(TaskTemplate.VENDOR_ID == vendor_id)
    tasks = q.order_by(TaskTemplate.SEQUENCE_NUMBER).all()
    return _enrich_tasks(tasks, db)


@router.post("/task-templates")
def create_task_template(data: TaskTemplateCreate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.ID == data.PROJECT_ID).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    task = TaskTemplate(
        PROJECT_ID=data.PROJECT_ID,
        NAME=data.NAME,
        DESCRIPTION=data.DESCRIPTION,
        DURATION_VALUE=data.DURATION_VALUE,
        DURATION_UNIT=data.DURATION_UNIT,
        SEQUENCE_NUMBER=data.SEQUENCE_NUMBER,
        DEPARTMENT_ID=data.DEPARTMENT_ID,
        ROLE_ID=data.ROLE_ID,
        VENDOR_ID=data.VENDOR_ID
    )
    db.add(task)
    db.flush()
    _recalc_project_duration(project, db)
    db.commit()
    db.refresh(task)
    return {"message": "Task created", "ID": task.ID}


@router.post("/task-templates/bulk-create")
def bulk_create_task_templates():
    raise HTTPException(status_code=501, detail="Use POST /projects with embedded tasks instead")


@router.put("/task-templates/{task_id}")
def update_task_template(task_id: str, data: TaskTemplateUpdate, db: Session = Depends(get_db)):
    task = db.query(TaskTemplate).filter(TaskTemplate.ID == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if data.NAME is not None:
        task.NAME = data.NAME
    if data.DESCRIPTION is not None:
        task.DESCRIPTION = data.DESCRIPTION
    if data.DURATION_VALUE is not None:
        task.DURATION_VALUE = data.DURATION_VALUE
    if data.DURATION_UNIT is not None:
        task.DURATION_UNIT = data.DURATION_UNIT
    if data.SEQUENCE_NUMBER is not None:
        task.SEQUENCE_NUMBER = data.SEQUENCE_NUMBER
    if data.DEPARTMENT_ID is not None:
        task.DEPARTMENT_ID = data.DEPARTMENT_ID
    if data.ROLE_ID is not None:
        task.ROLE_ID = data.ROLE_ID
    db.flush()
    project = db.query(Project).filter(Project.ID == task.PROJECT_ID).first()
    if project:
        _recalc_project_duration(project, db)
    db.commit()
    return {"message": "Task updated"}


@router.delete("/task-templates/{task_id}")
def delete_task_template(task_id: str, db: Session = Depends(get_db)):
    task = db.query(TaskTemplate).filter(TaskTemplate.ID == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    project_id = task.PROJECT_ID
    db.query(CustomFieldTableValue).filter(
        CustomFieldTableValue.TABLE_NAME == "task_template",
        CustomFieldTableValue.TABLE_ROW_ID == str(task_id),
    ).delete(synchronize_session=False)
    db.delete(task)
    db.flush()
    project = db.query(Project).filter(Project.ID == project_id).first()
    if project:
        _recalc_project_duration(project, db)
    db.commit()
    return {"message": "Task deleted"}


@router.patch("/task-templates/reorder")
def reorder_tasks(items: List[ReorderItem], db: Session = Depends(get_db)):
    for item in items:
        task = db.query(TaskTemplate).filter(TaskTemplate.ID == item.id).first()
        if task:
            task.SEQUENCE_NUMBER = item.sequence_number
    db.commit()
    return {"message": "Tasks reordered"}


# =========================
# BULK UPLOAD — SHARED HELPERS
# =========================

def _cf_fields_for_table(table_name: str, vendor_id: int, db: Session):
    """Return CustomField rows for a table, sorted by SORT_ORDER."""
    return (
        db.query(CustomField)
          .filter(CustomField.TABLE_NAME == table_name, CustomField.VENDOR_ID == vendor_id)
          .order_by(CustomField.SORT_ORDER, CustomField.FIELD_NAME)
          .all()
    )


def _upsert_cf_bulk(row_id: str, table_name: str, cf_field_id: str, value, db: Session):
    """Insert or update a single custom-field value row."""
    stored = value if value else None
    existing = (
        db.query(CustomFieldTableValue)
          .filter(
              CustomFieldTableValue.TABLE_NAME == table_name,
              CustomFieldTableValue.TABLE_ROW_ID == str(row_id),
              CustomFieldTableValue.CUSTOM_FIELD_ID == cf_field_id,
          )
          .first()
    )
    if existing:
        existing.CUSTOM_FIELD_VALUE = stored
    elif stored is not None:
        db.add(CustomFieldTableValue(
            TABLE_NAME=table_name,
            TABLE_ROW_ID=str(row_id),
            CUSTOM_FIELD_ID=cf_field_id,
            CUSTOM_FIELD_VALUE=stored,
        ))


def _validate_cf_value(field, raw_val) -> Optional[str]:
    """Validate a raw bulk-upload value against the field's type and options.
    Returns an error message string if invalid, or None if valid/empty."""
    import re as _re
    from datetime import date as _d, datetime as _dt

    if raw_val is None or str(raw_val).strip() == "":
        return None  # emptiness is handled by the required check

    val = str(raw_val).strip()
    ft  = field.FIELD_TYPE

    if ft == "NUMBER":
        try:
            float(val)
        except ValueError:
            return "Must be a number"

    elif ft == "EMAIL":
        if not _re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", val):
            return "Must be a valid email address (e.g. user@example.com)"

    elif ft == "PHONE":
        if not _re.fullmatch(r"\+?[\d\s\-().]{7,20}", val):
            return "Must be a valid phone number"

    elif ft == "DATE":
        try:
            _d.fromisoformat(val)
        except ValueError:
            return "Must be a valid date (YYYY-MM-DD)"

    elif ft == "DATETIME":
        try:
            _dt.fromisoformat(val)
        except ValueError:
            return "Must be a valid date/time (YYYY-MM-DDTHH:MM)"

    elif ft in ("SELECT", "RADIO"):
        allowed = field.OPTIONS or []
        if allowed and val not in allowed:
            return f'Invalid option "{val}". Allowed values: {", ".join(allowed)}'

    elif ft == "CHECKBOX":
        allowed = set(field.OPTIONS or [])
        if allowed:
            items = [v.strip() for v in val.split(",") if v.strip()] if isinstance(raw_val, str) else [val]
            bad = [v for v in items if v not in allowed]
            if bad:
                return f'Invalid option(s): {", ".join(bad)}. Allowed: {", ".join(field.OPTIONS or [])}'

    return None


def _cf_row_changed(row_id: str, table_name: str, cf_vals_by_id: dict, db: Session) -> bool:
    """Return True if any value in cf_vals_by_id {cf_id: new_val} differs from the stored value."""
    for cf_id, new_val in cf_vals_by_id.items():
        row = (
            db.query(CustomFieldTableValue)
              .filter(
                  CustomFieldTableValue.TABLE_NAME == table_name,
                  CustomFieldTableValue.TABLE_ROW_ID == str(row_id),
                  CustomFieldTableValue.CUSTOM_FIELD_ID == cf_id,
              )
              .first()
        )
        old_s = str(row.CUSTOM_FIELD_VALUE) if (row and row.CUSTOM_FIELD_VALUE is not None) else ""
        new_s = str(new_val) if new_val else ""
        if old_s != new_s:
            return True
    return False


def _parse_bulk_xl(content: bytes, required_sheet: str):
    """Parse an Excel workbook for bulk upload.

    Requires the workbook to contain a sheet named exactly `required_sheet`
    (case-sensitive). Raises HTTPException 400 if the sheet is absent.
    Returns (headers_upper, data_rows).
    """
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    if required_sheet not in wb.sheetnames:
        available = ", ".join(f'"{s}"' for s in wb.sheetnames)
        raise HTTPException(
            status_code=400,
            detail=f'Sheet "{required_sheet}" not found in the uploaded file. '
                   f'Available sheets: {available}. '
                   f'Please use the Template download to get a correctly named workbook.',
        )
    ws = wb[required_sheet]
    headers: Optional[List[str]] = None
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c).strip().upper() if c is not None else "" for c in row]
            continue
        if all(c is None for c in row):
            continue
        rows.append(row)
    return headers, rows


def _cell(record: dict, *keys) -> str:
    """Extract and strip a value from an upper-cased record dict."""
    for k in keys:
        v = record.get(k.upper())
        if v is not None:
            s = str(v).strip()
            if s:
                return s
    return ""


# =========================
# PROJECT CATEGORIES BULK UPLOAD
# =========================

_CAT_STD_COLS = {"CATEGORY NAME", "DESCRIPTION", "S.NO", "S.N", "SN", ""}


@router.post("/project-categories/bulk-upload")
async def bulk_upload_categories(
    vendor_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content = await file.read()
    headers, data_rows = _parse_bulk_xl(content, "Categories")

    cf_fields = _cf_fields_for_table("project_category", vendor_id, db)
    cf_by_upper = {f.FIELD_NAME.upper(): f for f in cf_fields}
    cf_cols = [h for h in headers if h not in _CAT_STD_COLS and h in cf_by_upper]

    inserted = updated = skipped = 0
    errors: List[dict] = []

    for row_num, raw in enumerate(data_rows, start=2):
        record = {headers[i].upper(): raw[i] for i in range(len(headers))}

        cat_name = _cell(record, "CATEGORY NAME")
        desc     = _cell(record, "DESCRIPTION") or None

        if not cat_name:
            errors.append({"row": row_num, "field": "Category Name", "message": "Category Name is required"})
            continue

        # Validate CFs (required + type)
        cf_vals: dict = {}
        cf_error = False
        for col in cf_cols:
            cf_f = cf_by_upper[col]
            val  = _cell(record, col) or None
            if cf_f.IS_REQUIRED and not val:
                errors.append({
                    "row": row_num, "field": cf_f.FIELD_NAME,
                    "message": f'Required custom field "{cf_f.FIELD_NAME}" is missing',
                })
                cf_error = True
            elif val:
                type_err = _validate_cf_value(cf_f, val)
                if type_err:
                    errors.append({"row": row_num, "field": cf_f.FIELD_NAME, "message": type_err})
                    cf_error = True
            cf_vals[cf_f.ID] = val
        if cf_error:
            continue

        existing = (
            db.query(ProjectCategory)
              .filter(ProjectCategory.VENDOR_ID == vendor_id, ProjectCategory.NAME == cat_name)
              .first()
        )

        if existing:
            row_changed = (desc or "") != (existing.DESCRIPTION or "")
            if row_changed or _cf_row_changed(existing.ID, "project_category", cf_vals, db):
                if row_changed:
                    existing.DESCRIPTION = desc
                for cf_id, val in cf_vals.items():
                    _upsert_cf_bulk(existing.ID, "project_category", cf_id, val, db)
                updated += 1
            else:
                skipped += 1
        else:
            new_cat = ProjectCategory(NAME=cat_name, DESCRIPTION=desc, VENDOR_ID=vendor_id)
            db.add(new_cat)
            db.flush()
            for cf_id, val in cf_vals.items():
                _upsert_cf_bulk(new_cat.ID, "project_category", cf_id, val, db)
            inserted += 1

    db.commit()
    total = inserted + updated + skipped + len(errors)
    msg   = f"Upload complete: {inserted} inserted, {updated} updated, {skipped} skipped"
    if errors:
        msg += f", {len(errors)} error(s)"
    return {
        "message": msg,
        "inserted": inserted, "updated": updated, "skipped": skipped,
        "total_rows": total, "errors": errors,
    }


# =========================
# PROJECTS BULK UPLOAD
# =========================

_PROJ_STD_COLS = {"CATEGORY NAME", "PROJECT NAME", "DESCRIPTION", "S.NO", "S.N", "SN", ""}


@router.post("/projects/bulk-upload")
async def bulk_upload_projects(
    vendor_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content = await file.read()
    headers, data_rows = _parse_bulk_xl(content, "Projects")

    cf_fields  = _cf_fields_for_table("project", vendor_id, db)
    cf_by_upper = {f.FIELD_NAME.upper(): f for f in cf_fields}
    cf_cols    = [h for h in headers if h not in _PROJ_STD_COLS and h in cf_by_upper]

    # Pre-build category lookup map (case-insensitive)
    cat_name_map = {
        c.NAME.strip().lower(): c
        for c in db.query(ProjectCategory).filter(ProjectCategory.VENDOR_ID == vendor_id).all()
    }

    inserted = updated = skipped = 0
    errors: List[dict] = []

    for row_num, raw in enumerate(data_rows, start=2):
        record = {headers[i].upper(): raw[i] for i in range(len(headers))}

        cat_name  = _cell(record, "CATEGORY NAME")
        proj_name = _cell(record, "PROJECT NAME")
        desc      = _cell(record, "DESCRIPTION") or None

        if not proj_name:
            errors.append({"row": row_num, "field": "Project Name", "message": "Project Name is required"})
            continue
        if not cat_name:
            errors.append({"row": row_num, "field": "Category Name", "message": "Category Name is required"})
            continue

        cat = cat_name_map.get(cat_name.lower())
        if not cat:
            errors.append({
                "row": row_num, "field": "Category Name",
                "message": f'Category "{cat_name}" not found',
            })
            continue

        cf_vals: dict = {}
        cf_error = False
        for col in cf_cols:
            cf_f = cf_by_upper[col]
            val  = _cell(record, col) or None
            if cf_f.IS_REQUIRED and not val:
                errors.append({
                    "row": row_num, "field": cf_f.FIELD_NAME,
                    "message": f'Required custom field "{cf_f.FIELD_NAME}" is missing',
                })
                cf_error = True
            elif val:
                type_err = _validate_cf_value(cf_f, val)
                if type_err:
                    errors.append({"row": row_num, "field": cf_f.FIELD_NAME, "message": type_err})
                    cf_error = True
            cf_vals[cf_f.ID] = val
        if cf_error:
            continue

        existing = (
            db.query(Project)
              .filter(
                  Project.VENDOR_ID == vendor_id,
                  Project.CATEGORY_ID == cat.ID,
                  Project.NAME == proj_name,
              )
              .first()
        )

        if existing:
            row_changed = (
                (desc or "") != (existing.DESCRIPTION or "") or
                cat.ID != existing.CATEGORY_ID
            )
            if row_changed or _cf_row_changed(existing.ID, "project", cf_vals, db):
                if row_changed:
                    existing.DESCRIPTION = desc
                    existing.CATEGORY_ID = cat.ID
                for cf_id, val in cf_vals.items():
                    _upsert_cf_bulk(existing.ID, "project", cf_id, val, db)
                updated += 1
            else:
                skipped += 1
        else:
            new_proj = Project(
                CATEGORY_ID=cat.ID,
                NAME=proj_name,
                DESCRIPTION=desc,
                BOM_MODE="MANUAL",
                ESTIMATED_TOTAL_DAYS=0.0,
                VENDOR_ID=vendor_id,
            )
            db.add(new_proj)
            db.flush()
            for cf_id, val in cf_vals.items():
                _upsert_cf_bulk(new_proj.ID, "project", cf_id, val, db)
            inserted += 1

    db.commit()
    total = inserted + updated + skipped + len(errors)
    msg   = f"Upload complete: {inserted} inserted, {updated} updated, {skipped} skipped"
    if errors:
        msg += f", {len(errors)} error(s)"
    return {
        "message": msg,
        "inserted": inserted, "updated": updated, "skipped": skipped,
        "total_rows": total, "errors": errors,
    }


# =========================
# TASK TEMPLATES BULK UPLOAD
# =========================

_TASK_STD_COLS = {
    "PROJECT NAME", "TASK NAME", "DESCRIPTION",
    "DURATION VALUE", "DURATION UNIT", "DEPARTMENT", "ROLE", "SEQUENCE",
    "S.NO", "S.N", "SN", "",
}
_VALID_DUR_UNITS = {"HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"}


@router.post("/task-templates/bulk-upload")
async def bulk_upload_task_templates(
    vendor_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content = await file.read()
    headers, data_rows = _parse_bulk_xl(content, "Tasks")

    cf_fields   = _cf_fields_for_table("task_template", vendor_id, db)
    cf_by_upper = {f.FIELD_NAME.upper(): f for f in cf_fields}
    cf_cols     = [h for h in headers if h not in _TASK_STD_COLS and h in cf_by_upper]

    # Pre-build lookup maps
    proj_name_map = {
        p.NAME.strip().lower(): p
        for p in db.query(Project).filter(Project.VENDOR_ID == vendor_id).all()
    }
    dept_name_map = {
        d.NAME.strip().lower(): d
        for d in db.query(Department).filter(Department.VENDOR_ID == vendor_id).all()
    }
    role_name_map = {
        r.NAME.strip().lower(): r
        for r in db.query(Role).filter(Role.VENDOR_ID == vendor_id).all()
    }

    inserted = updated = skipped = 0
    errors: List[dict] = []
    modified_proj_ids: set = set()
    # Lazy sequence counter per project for auto-assigned sequences
    proj_next_seq: dict = {}

    for row_num, raw in enumerate(data_rows, start=2):
        record = {headers[i].upper(): raw[i] for i in range(len(headers))}

        proj_name = _cell(record, "PROJECT NAME")
        task_name = _cell(record, "TASK NAME")
        desc      = _cell(record, "DESCRIPTION") or None
        dur_val_s = _cell(record, "DURATION VALUE")
        dur_unit  = _cell(record, "DURATION UNIT").upper() or "DAYS"
        dept_name = _cell(record, "DEPARTMENT")
        role_name = _cell(record, "ROLE")
        seq_s     = _cell(record, "SEQUENCE")

        # Required field checks
        if not proj_name:
            errors.append({"row": row_num, "field": "Project Name", "message": "Project Name is required"})
            continue
        if not task_name:
            errors.append({"row": row_num, "field": "Task Name", "message": "Task Name is required"})
            continue

        proj = proj_name_map.get(proj_name.lower())
        if not proj:
            errors.append({
                "row": row_num, "field": "Project Name",
                "message": f'Project "{proj_name}" not found',
            })
            continue

        # Duration value
        try:
            dur_val = float(dur_val_s) if dur_val_s else 1.0
            if dur_val <= 0:
                raise ValueError
        except ValueError:
            errors.append({
                "row": row_num, "field": "Duration Value",
                "message": f'Invalid duration value "{dur_val_s}" — must be a positive number',
            })
            continue

        if dur_unit not in _VALID_DUR_UNITS:
            dur_unit = "DAYS"

        # Department (optional; error if provided but not found)
        dept_id = None
        if dept_name:
            d = dept_name_map.get(dept_name.lower())
            if not d:
                errors.append({
                    "row": row_num, "field": "Department",
                    "message": f'Department "{dept_name}" does not exist',
                })
                continue
            dept_id = d.ID

        # Role (optional; error if provided but not found)
        role_id = None
        if role_name:
            r = role_name_map.get(role_name.lower())
            if not r:
                errors.append({
                    "row": row_num, "field": "Role",
                    "message": f'Role "{role_name}" does not exist',
                })
                continue
            role_id = r.ID

        # Sequence
        seq: Optional[int] = None
        if seq_s:
            try:
                seq = int(float(seq_s))
            except ValueError:
                pass
        if seq is None:
            # Auto-assign: start from current task count for this project
            if proj.ID not in proj_next_seq:
                count = db.query(TaskTemplate).filter(TaskTemplate.PROJECT_ID == proj.ID).count()
                proj_next_seq[proj.ID] = count
            seq = proj_next_seq[proj.ID]
            proj_next_seq[proj.ID] += 1

        # Custom fields (required + type validation)
        cf_vals: dict = {}
        cf_error = False
        for col in cf_cols:
            cf_f = cf_by_upper[col]
            val  = _cell(record, col) or None
            if cf_f.IS_REQUIRED and not val:
                errors.append({
                    "row": row_num, "field": cf_f.FIELD_NAME,
                    "message": f'Required custom field "{cf_f.FIELD_NAME}" is missing',
                })
                cf_error = True
            elif val:
                type_err = _validate_cf_value(cf_f, val)
                if type_err:
                    errors.append({"row": row_num, "field": cf_f.FIELD_NAME, "message": type_err})
                    cf_error = True
            cf_vals[cf_f.ID] = val
        if cf_error:
            continue

        existing = (
            db.query(TaskTemplate)
              .filter(
                  TaskTemplate.PROJECT_ID == proj.ID,
                  TaskTemplate.NAME == task_name,
              )
              .first()
        )

        if existing:
            row_changed = (
                (desc or "") != (existing.DESCRIPTION or "")
                or abs(float(dur_val) - float(existing.DURATION_VALUE or 1.0)) > 0.001
                or dur_unit != existing.DURATION_UNIT
                or dept_id != existing.DEPARTMENT_ID
                or role_id != existing.ROLE_ID
            )
            if row_changed or _cf_row_changed(existing.ID, "task_template", cf_vals, db):
                if row_changed:
                    existing.DESCRIPTION = desc
                    existing.DURATION_VALUE = dur_val
                    existing.DURATION_UNIT  = dur_unit
                    existing.DEPARTMENT_ID  = dept_id
                    existing.ROLE_ID        = role_id
                for cf_id, val in cf_vals.items():
                    _upsert_cf_bulk(existing.ID, "task_template", cf_id, val, db)
                modified_proj_ids.add(proj.ID)
                updated += 1
            else:
                skipped += 1
        else:
            new_task = TaskTemplate(
                PROJECT_ID      = proj.ID,
                NAME            = task_name,
                DESCRIPTION     = desc,
                DURATION_VALUE  = dur_val,
                DURATION_UNIT   = dur_unit,
                SEQUENCE_NUMBER = seq,
                DEPARTMENT_ID   = dept_id,
                ROLE_ID         = role_id,
                VENDOR_ID       = vendor_id,
            )
            db.add(new_task)
            db.flush()
            for cf_id, val in cf_vals.items():
                _upsert_cf_bulk(new_task.ID, "task_template", cf_id, val, db)
            modified_proj_ids.add(proj.ID)
            inserted += 1

    # Recalculate estimated duration for every touched project
    for pid in modified_proj_ids:
        proj_obj = db.query(Project).filter(Project.ID == pid).first()
        if proj_obj:
            _recalc_project_duration(proj_obj, db)

    db.commit()
    total = inserted + updated + skipped + len(errors)
    msg   = f"Upload complete: {inserted} inserted, {updated} updated, {skipped} skipped"
    if errors:
        msg += f", {len(errors)} error(s)"
    return {
        "message": msg,
        "inserted": inserted, "updated": updated, "skipped": skipped,
        "total_rows": total, "errors": errors,
    }


# =========================
# SEED
# =========================

@router.post("/seed-project-templates")
def seed_templates(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    from app.services.seed_data import PROJECT_TEMPLATE_CATALOG
    created_cats = 0
    created_projects = 0
    for entry in PROJECT_TEMPLATE_CATALOG:
        cat_name = entry.get("category")
        template_name = entry.get("name")
        if not cat_name or not template_name:
            continue
        cat = db.query(ProjectCategory).filter(
            ProjectCategory.VENDOR_ID == vendor_id,
            ProjectCategory.NAME == cat_name
        ).first()
        if not cat:
            cat = ProjectCategory(NAME=cat_name, VENDOR_ID=vendor_id)
            db.add(cat)
            db.flush()
            created_cats += 1
        existing = db.query(Project).filter(
            Project.VENDOR_ID == vendor_id,
            Project.CATEGORY_ID == cat.ID,
            Project.NAME == template_name
        ).first()
        if not existing:
            db.add(Project(
                CATEGORY_ID=cat.ID,
                NAME=template_name,
                DESCRIPTION=entry.get("description"),
                ESTIMATED_TOTAL_DAYS=0.0,
                VENDOR_ID=vendor_id
            ))
            created_projects += 1
    db.commit()
    return {
        "message": f"Seed complete: {created_cats} categories, {created_projects} projects created"
    }
