from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from app.database.database import get_db

from app.models.models import (
    ProjectCategory,
    SubProjectTemplate
)

from app.services.seed_data import PROJECT_TEMPLATE_CATALOG


router = APIRouter()


# =========================
# SCHEMAS
# =========================

class CategoryCreate(BaseModel):

    SECTION: str
    NAME: str
    DESCRIPTION: Optional[str] = None


class SubTemplateCreate(BaseModel):

    CATEGORY_ID: int
    NAME: str
    DESCRIPTION: Optional[str] = None
    ESTIMATED_TOTAL_DAYS: int = 30


# =========================
# SECTIONS (distinct values)
# =========================

@router.get("/project-sections")
def list_sections(
    db: Session = Depends(get_db)
):
    """
    Returns the distinct SECTION values currently in use.
    Always returns TECHNOLOGY + INDUSTRY at minimum so the
    UI dropdown is populated even before seeding.
    """

    rows = db.query(ProjectCategory.SECTION).distinct().all()

    sections = sorted({r[0] for r in rows if r[0]})

    for default in ("TECHNOLOGY", "INDUSTRY"):

        if default not in sections:

            sections.append(default)

    return sorted(sections)


# =========================
# CATEGORIES (optionally filtered by section)
# =========================

@router.get("/project-categories")
def list_categories(
    section: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(ProjectCategory)

    if section:

        q = q.filter(ProjectCategory.SECTION == section.upper())

    rows = q.order_by(
        ProjectCategory.SECTION,
        ProjectCategory.NAME
    ).all()

    return [
        {
            "ID": r.ID,
            "SECTION": r.SECTION,
            "NAME": r.NAME,
            "DESCRIPTION": r.DESCRIPTION
        }
        for r in rows
    ]


@router.post("/project-categories")
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db)
):

    existing = db.query(ProjectCategory).filter(
        ProjectCategory.NAME == data.NAME
    ).first()

    if existing:

        raise HTTPException(
            status_code=400,
            detail=f"Category '{data.NAME}' already exists"
        )

    row = ProjectCategory(
        SECTION=data.SECTION.upper(),
        NAME=data.NAME,
        DESCRIPTION=data.DESCRIPTION
    )

    db.add(row)

    db.commit()

    db.refresh(row)

    return {
        "ID": row.ID,
        "SECTION": row.SECTION,
        "NAME": row.NAME,
        "DESCRIPTION": row.DESCRIPTION
    }


@router.delete("/project-categories/{category_id}")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db)
):

    row = db.query(ProjectCategory).filter(
        ProjectCategory.ID == category_id
    ).first()

    if not row:

        raise HTTPException(
            status_code=404,
            detail="Category not found"
        )

    in_use = db.query(SubProjectTemplate).filter(
        SubProjectTemplate.CATEGORY_ID == category_id
    ).first()

    if in_use:

        raise HTTPException(
            status_code=400,
            detail=(
                "Category has sub-project templates. "
                "Delete those first."
            )
        )

    db.delete(row)

    db.commit()

    return {"message": "Category deleted"}


# =========================
# SUB-PROJECT TEMPLATES
# (optionally filtered by category)
# =========================

@router.get("/sub-project-templates")
def list_sub_templates(
    category_id: Optional[int] = Query(None),
    section: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(
        SubProjectTemplate,
        ProjectCategory
    ).join(
        ProjectCategory,
        SubProjectTemplate.CATEGORY_ID == ProjectCategory.ID
    )

    if category_id is not None:

        q = q.filter(SubProjectTemplate.CATEGORY_ID == category_id)

    if section:

        q = q.filter(ProjectCategory.SECTION == section.upper())

    rows = q.order_by(
        ProjectCategory.SECTION,
        ProjectCategory.NAME,
        SubProjectTemplate.NAME
    ).all()

    return [
        {
            "ID": sub.ID,
            "CATEGORY_ID": sub.CATEGORY_ID,
            "CATEGORY_NAME": cat.NAME,
            "SECTION": cat.SECTION,
            "NAME": sub.NAME,
            "DESCRIPTION": sub.DESCRIPTION,
            "ESTIMATED_TOTAL_DAYS": sub.ESTIMATED_TOTAL_DAYS
        }
        for sub, cat in rows
    ]


@router.post("/sub-project-templates")
def create_sub_template(
    data: SubTemplateCreate,
    db: Session = Depends(get_db)
):

    cat = db.query(ProjectCategory).filter(
        ProjectCategory.ID == data.CATEGORY_ID
    ).first()

    if not cat:

        raise HTTPException(
            status_code=400,
            detail="Category not found"
        )

    row = SubProjectTemplate(
        CATEGORY_ID=data.CATEGORY_ID,
        NAME=data.NAME,
        DESCRIPTION=data.DESCRIPTION,
        ESTIMATED_TOTAL_DAYS=data.ESTIMATED_TOTAL_DAYS
    )

    db.add(row)

    db.commit()

    db.refresh(row)

    return {
        "ID": row.ID,
        "CATEGORY_ID": row.CATEGORY_ID,
        "NAME": row.NAME,
        "DESCRIPTION": row.DESCRIPTION,
        "ESTIMATED_TOTAL_DAYS": row.ESTIMATED_TOTAL_DAYS
    }


@router.delete("/sub-project-templates/{template_id}")
def delete_sub_template(
    template_id: int,
    db: Session = Depends(get_db)
):

    row = db.query(SubProjectTemplate).filter(
        SubProjectTemplate.ID == template_id
    ).first()

    if not row:

        raise HTTPException(
            status_code=404,
            detail="Sub-project template not found"
        )

    db.delete(row)

    db.commit()

    return {"message": "Sub-project template deleted"}


# =========================
# SEED
# =========================

@router.post("/seed-project-templates")
def seed_project_templates(
    db: Session = Depends(get_db)
):
    """
    Idempotent seed of the project template catalog.
    Adds any missing categories and sub-project templates
    from PROJECT_TEMPLATE_CATALOG, leaves existing rows alone.
    """

    categories_created = 0

    subs_created = 0

    for section, categories in PROJECT_TEMPLATE_CATALOG.items():

        for category_name, sub_list in categories.items():

            cat = db.query(ProjectCategory).filter(
                ProjectCategory.NAME == category_name
            ).first()

            if not cat:

                cat = ProjectCategory(
                    SECTION=section,
                    NAME=category_name,
                    DESCRIPTION=None
                )

                db.add(cat)

                db.flush()  # get ID without committing

                categories_created += 1

            for sub_name, sub_desc, est_days in sub_list:

                existing_sub = db.query(SubProjectTemplate).filter(
                    SubProjectTemplate.CATEGORY_ID == cat.ID,
                    SubProjectTemplate.NAME == sub_name
                ).first()

                if existing_sub:

                    continue

                db.add(SubProjectTemplate(
                    CATEGORY_ID=cat.ID,
                    NAME=sub_name,
                    DESCRIPTION=sub_desc,
                    ESTIMATED_TOTAL_DAYS=est_days
                ))

                subs_created += 1

    db.commit()

    total_cat = db.query(ProjectCategory).count()

    total_sub = db.query(SubProjectTemplate).count()

    return {
        "message": (
            "Project template catalog synced"
            if (categories_created + subs_created) > 0
            else "Catalog already in sync"
        ),
        "categories_created": categories_created,
        "sub_templates_created": subs_created,
        "categories_total": total_cat,
        "sub_templates_total": total_sub
    }
