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
