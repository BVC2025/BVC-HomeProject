"""
Auto-detect the right department for a project, based on:

  1. The sub-project template's category (highest confidence)
  2. Keyword matching against project name + description
  3. A sensible default ("Production") if nothing else fits

Used by /create-project and the backfill endpoint when the
admin doesn't explicitly pick a department.
"""

from sqlalchemy.orm import Session

from app.models.models import (
    Department,
    ProjectCategory,
    SubProjectTemplate
)


# Map category names -> the most likely department.
# Add new categories here as the catalog grows.
CATEGORY_TO_DEPT = {
    # Technology categories — all go to Software
    "Web Development":        "Software",
    "Mobile Development":     "Software",
    "AI / Machine Learning":  "Software",
    "Cloud / DevOps":         "Software",
    "Data Engineering":       "Software",
    "Cybersecurity":          "Software",

    # Industry / manufacturing categories
    "Healthcare":             "Software",
    "Manufacturing":          "Production",
    "Retail":                 "Software",
    "Education":              "Software",
    "Finance / Banking":      "Software",
    "Logistics / Supply Chain": "Software",
    "Real Estate":            "Software"
}


# Keyword-based fallback: scan project name + description.
# Higher score = better match.
DEPARTMENT_KEYWORDS = {
    "Software": [
        "software", "app", "application", "web", "mobile",
        "frontend", "backend", "api", "saas", "platform",
        "dashboard", "system", "portal", "website",
        "cloud", "devops", "data", "analytics", "ai",
        "machine learning", "ml", "chatbot", "ocr",
        "module", "code", "programming"
    ],
    "Design": [
        "design", "cad", "ui", "ux", "logo", "branding",
        "mockup", "wireframe", "graphic"
    ],
    "Welding": [
        "welding", "weld", "weld bead"
    ],
    "Fabrication": [
        "fabrication", "fabricate", "sheet metal",
        "cutting", "bending"
    ],
    "Production": [
        "production", "manufacturing", "shop floor",
        "factory"
    ],
    "Assembly": [
        "assembly", "assemble", "fitment", "fitting"
    ],
    "Electrical": [
        "electrical", "wiring", "power supply", "circuit",
        "earthing"
    ],
    "Electronics": [
        "electronics", "pcb", "sensor", "microcontroller",
        "embedded", "firmware"
    ],
    "Quality Control": [
        "qc", "quality control", "inspection", "testing",
        "test plan", "validation"
    ],
    "Service": [
        "service", "support", "maintenance", "ticket",
        "helpdesk"
    ],
    "Installation": [
        "installation", "install", "deploy", "deployment",
        "rollout", "go-live"
    ],
    "Packaging & Dispatch": [
        "packaging", "dispatch", "shipping", "logistics",
        "delivery", "manifest", "carton"
    ],
    "Procurement": [
        "procurement", "purchase", "purchasing", "supplier",
        "vendor", "po release"
    ]
}


def _find_department(db: Session, name: str):

    if not name:

        return None

    return db.query(Department).filter(
        Department.NAME == name
    ).first()


def _detect_from_template(db: Session, sub_template_id):
    """
    If a sub-project template was picked, look up its
    category and map that to a department.
    """

    if not sub_template_id:

        return None

    template = db.query(SubProjectTemplate).filter(
        SubProjectTemplate.ID == sub_template_id
    ).first()

    if not template:

        return None

    category = db.query(ProjectCategory).filter(
        ProjectCategory.ID == template.CATEGORY_ID
    ).first()

    if not category:

        return None

    target_dept_name = CATEGORY_TO_DEPT.get(category.NAME)

    return _find_department(db, target_dept_name)


def _detect_from_text(db: Session, text: str):
    """
    Score each department by counting how many of its
    keywords appear in the text. Highest score wins.
    Returns None if no keyword matched.
    """

    if not text:

        return None

    text_l = text.lower()

    scores = {}

    for dept_name, keywords in DEPARTMENT_KEYWORDS.items():

        for kw in keywords:

            if kw in text_l:

                scores[dept_name] = scores.get(dept_name, 0) + 1

    if not scores:

        return None

    best_name = max(scores, key=scores.get)

    return _find_department(db, best_name)


def auto_detect_department_id(
    db: Session,
    project_name: str = "",
    description: str = "",
    sub_template_id=None
):
    """
    Returns a `Department.ID` for the most likely fit, or
    None if no detection method matched.

    Resolution order:
      1. Sub-project template's category mapping
      2. Keyword match on (project_name + description)
      3. None — caller decides whether to default
    """

    # Try template first — highest confidence
    dept = _detect_from_template(db, sub_template_id)

    if dept:

        return dept.ID, "template"

    # Fall back to keyword matching
    text = " ".join(filter(None, [project_name, description]))

    dept = _detect_from_text(db, text)

    if dept:

        return dept.ID, "keywords"

    return None, "none"
