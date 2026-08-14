"""
Employee Resume PDF — professional single-page profile export.

Renders the fields collected on the Add-Employee / Onboarding form
(personal, contact, employment, education, experience, skills, photo)
into a clean HTML template, then pipes it through xhtml2pdf (already
used by the payslip PDF and quotation PDF) to produce a downloadable
resume-style PDF.

Used by GET /employees/{id}/resume.pdf.
"""

from io import BytesIO
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Department,
    Designation,
    Employee,
    Role,
)


def _fmt_date(d) -> str:
    if not d:
        return ""
    try:
        return d.strftime("%d %b %Y")
    except Exception:
        return str(d)


def _esc(v) -> str:
    """HTML-escape a scalar, coercing None → empty string."""
    if v is None:
        return ""
    s = str(v)
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
    )


def _dash(v) -> str:
    """Escape a value; return an em-dash if empty."""
    s = _esc(v).strip()
    return s if s else "&mdash;"


def _photo_data_uri(photo_url: Optional[str]) -> str:
    """Read the local photo file (if any) and inline as base64 so the
    PDF stays self-contained. Returns an empty string when no photo."""
    if not photo_url:
        return ""
    # PHOTO_URL is stored as "/static/employee/<file>". Files live at
    # backend/static/employee/<file> so walk up from this file's dir.
    _here = Path(__file__).resolve().parent  # backend/app/services
    backend_root = _here.parent.parent       # backend/
    rel = str(photo_url).lstrip("/")         # static/employee/xxx.jpg
    path = backend_root / rel
    if not path.exists():
        return ""
    try:
        import base64
        ext = (path.suffix.lower().lstrip(".") or "jpg")
        if ext == "jpg":
            mime = "image/jpeg"
        elif ext in ("jpeg", "png", "gif", "webp"):
            mime = f"image/{'jpeg' if ext == 'jpeg' else ext}"
        else:
            return ""
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{data}"
    except Exception:
        return ""


def _row(label: str, value) -> str:
    """One label/value row inside a section table."""
    return (
        '<tr>'
        f'<td class="lbl">{_esc(label)}</td>'
        f'<td class="val">{_dash(value)}</td>'
        '</tr>'
    )


def build_resume_html(db: Session, emp: Employee) -> str:
    """Return the full HTML doc for the resume PDF."""

    dept = None
    desig = None
    role = None
    if emp.DEPARTMENT_ID:
        dept = db.query(Department).filter(Department.ID == emp.DEPARTMENT_ID).first()
    if emp.DESIGNATION_ID:
        desig = db.query(Designation).filter(Designation.ID == emp.DESIGNATION_ID).first()
    if emp.ROLE_ID:
        role = db.query(Role).filter(Role.ID == emp.ROLE_ID).first()

    dept_name  = getattr(dept, "NAME", None) or getattr(dept, "DEPARTMENT_NAME", None) or ""
    desig_name = getattr(desig, "NAME", None) or getattr(desig, "DESIGNATION_NAME", None) or ""
    role_name  = getattr(role, "NAME", None) or ""

    photo = _photo_data_uri(emp.PHOTO_URL)

    address_parts = [emp.ADDRESS, emp.CITY, emp.STATE, emp.PINCODE]
    address_line = ", ".join([p for p in address_parts if p])

    edu_line = ""
    if emp.QUALIFICATION or emp.COLLEGE or emp.YEAR_OF_PASSING or emp.PERCENTAGE:
        parts = []
        if emp.QUALIFICATION: parts.append(_esc(emp.QUALIFICATION))
        if emp.COLLEGE: parts.append(_esc(emp.COLLEGE))
        if emp.UNIVERSITY and emp.UNIVERSITY != emp.COLLEGE:
            parts.append(_esc(emp.UNIVERSITY))
        yr_pct = []
        if emp.YEAR_OF_PASSING: yr_pct.append(f"class of {_esc(emp.YEAR_OF_PASSING)}")
        if emp.PERCENTAGE is not None:
            yr_pct.append(f"{_esc(emp.PERCENTAGE)}%")
        if yr_pct: parts.append(" · ".join(yr_pct))
        edu_line = "<br/>".join(parts)

    experience_block = ""
    if emp.EXPERIENCE_YEARS or emp.EXPERIENCE_DETAILS or emp.PAST_PROJECTS:
        yrs = f"{_esc(emp.EXPERIENCE_YEARS)} year(s)" if emp.EXPERIENCE_YEARS else ""
        experience_block = (
            f'<div class="section">'
            f'<div class="section-title">Experience</div>'
            f'<div class="section-body">'
        )
        if yrs:
            experience_block += f'<p><b>Total experience:</b> {yrs}</p>'
        if emp.EXPERIENCE_DETAILS:
            experience_block += f'<p>{_esc(emp.EXPERIENCE_DETAILS)}</p>'
        if emp.PAST_PROJECTS:
            experience_block += (
                f'<p><b>Notable projects:</b><br/>{_esc(emp.PAST_PROJECTS)}</p>'
            )
        experience_block += '</div></div>'

    skills_block = ""
    if emp.SKILLS:
        pills = "".join(
            f'<span class="pill">{_esc(s.strip())}</span>'
            for s in str(emp.SKILLS).split(",") if s.strip()
        )
        if pills:
            skills_block = (
                '<div class="section">'
                '<div class="section-title">Skills</div>'
                f'<div class="section-body pills">{pills}</div>'
                '</div>'
            )

    notes_block = ""
    if emp.NOTES:
        notes_block = (
            '<div class="section">'
            '<div class="section-title">Notes</div>'
            f'<div class="section-body"><p>{_esc(emp.NOTES)}</p></div>'
            '</div>'
        )

    photo_html = (
        f'<img class="avatar" src="{photo}" />'
        if photo else
        f'<div class="avatar avatar-initials">{_esc((emp.NAME or "?")[:2].upper())}</div>'
    )

    subtitle_parts = []
    if desig_name: subtitle_parts.append(_esc(desig_name))
    if dept_name:  subtitle_parts.append(_esc(dept_name))
    subtitle = " · ".join(subtitle_parts) or "&nbsp;"

    return f"""
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Employee Profile — {_esc(emp.NAME or emp.EMPLOYEE_CODE)}</title>
<style>
  @page {{
    size: A4;
    margin: 22mm 18mm 20mm 18mm;
  }}
  body {{
    font-family: Helvetica, Arial, sans-serif;
    color: #0f172a;
    font-size: 10.5pt;
    line-height: 1.45;
  }}
  .header {{
    border-bottom: 2px solid #C8102E;
    padding-bottom: 12px;
    margin-bottom: 14px;
  }}
  .header-tbl {{ width: 100%; border-collapse: collapse; }}
  .header-tbl td {{ vertical-align: middle; padding: 0; }}
  .avatar {{
    width: 84px; height: 84px;
    border-radius: 6px;
    object-fit: cover;
    border: 1px solid #e5e7eb;
  }}
  .avatar-initials {{
    display: inline-block;
    width: 84px; height: 84px;
    line-height: 84px;
    text-align: center;
    background: #C8102E;
    color: white;
    font-size: 30pt;
    font-weight: bold;
    border-radius: 6px;
  }}
  .name-block {{
    padding-left: 16px;
  }}
  .name {{
    font-size: 20pt;
    font-weight: bold;
    letter-spacing: -0.3pt;
    color: #0f172a;
    margin: 0;
  }}
  .subtitle {{
    font-size: 11pt;
    color: #475569;
    margin-top: 2px;
  }}
  .emp-code {{
    display: inline-block;
    margin-top: 6px;
    padding: 2px 8px;
    background: #fee2e2;
    color: #C8102E;
    font-size: 9pt;
    font-weight: bold;
    letter-spacing: 0.5pt;
    border-radius: 3px;
  }}
  .status-pill {{
    display: inline-block;
    margin-left: 6px;
    padding: 2px 8px;
    background: #dcfce7;
    color: #166534;
    font-size: 9pt;
    font-weight: bold;
    letter-spacing: 0.5pt;
    border-radius: 3px;
  }}

  .cols {{ width: 100%; border-collapse: collapse; }}
  .cols > tbody > tr > td {{
    width: 50%;
    vertical-align: top;
    padding: 0 8px;
  }}
  .cols > tbody > tr > td.first {{ padding-left: 0; padding-right: 12px; }}
  .cols > tbody > tr > td.second {{ padding-right: 0; padding-left: 12px; }}

  .section {{
    margin-bottom: 14px;
  }}
  .section-title {{
    font-size: 9pt;
    font-weight: bold;
    color: #C8102E;
    letter-spacing: 1.2pt;
    text-transform: uppercase;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 3px;
    margin-bottom: 6px;
  }}
  .section-body {{
    font-size: 10pt;
    color: #334155;
  }}
  .section-body p {{
    margin: 0 0 6px 0;
  }}

  .kv {{ width: 100%; border-collapse: collapse; }}
  .kv td {{ padding: 3px 0; vertical-align: top; }}
  .kv td.lbl {{
    width: 42%;
    color: #64748b;
    font-size: 9.5pt;
  }}
  .kv td.val {{
    color: #0f172a;
    font-size: 10pt;
    font-weight: 500;
  }}

  .pills {{ line-height: 1.9; }}
  .pill {{
    display: inline-block;
    padding: 3px 9px;
    margin: 2px 3px 2px 0;
    background: #f1f5f9;
    color: #0f172a;
    font-size: 9.5pt;
    border-radius: 3px;
    border: 1px solid #e5e7eb;
  }}

  .footer {{
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    color: #94a3b8;
    font-size: 8.5pt;
    text-align: center;
  }}
</style>
</head>
<body>

  <!-- ============ HEADER ============ -->
  <div class="header">
    <table class="header-tbl">
      <tr>
        <td width="90">{photo_html}</td>
        <td class="name-block">
          <div class="name">{_esc(emp.NAME or "—")}</div>
          <div class="subtitle">{subtitle}</div>
          <div>
            <span class="emp-code">{_esc(emp.EMPLOYEE_CODE or "—")}</span>
            <span class="status-pill">{_esc(emp.STATUS or "—")}</span>
          </div>
        </td>
      </tr>
    </table>
  </div>

  <!-- ============ TWO-COLUMN BODY ============ -->
  <table class="cols">
    <tr>
      <td class="first">

        <!-- Contact -->
        <div class="section">
          <div class="section-title">Contact</div>
          <div class="section-body">
            <table class="kv">
              {_row("Email", emp.EMAIL)}
              {_row("Phone", emp.PHONE)}
              {_row("Address", address_line)}
            </table>
          </div>
        </div>

        <!-- Personal -->
        <div class="section">
          <div class="section-title">Personal</div>
          <div class="section-body">
            <table class="kv">
              {_row("Date of birth", _fmt_date(emp.DOB))}
              {_row("Gender", emp.GENDER)}
              {_row("Marital status", emp.MARITAL_STATUS)}
              {_row("Nationality", emp.NATIONALITY)}
              {_row("Blood group", emp.BLOOD_GROUP)}
              {_row("Father's name", emp.FATHER_NAME)}
              {_row("Mother's name", emp.MOTHER_NAME)}
            </table>
          </div>
        </div>

        <!-- Emergency contact -->
        <div class="section">
          <div class="section-title">Emergency Contact</div>
          <div class="section-body">
            <table class="kv">
              {_row("Name", emp.EMERGENCY_CONTACT_NAME)}
              {_row("Phone", emp.EMERGENCY_CONTACT_PHONE)}
              {_row("Relation", emp.EMERGENCY_CONTACT_RELATION)}
            </table>
          </div>
        </div>

      </td>
      <td class="second">

        <!-- Employment -->
        <div class="section">
          <div class="section-title">Employment</div>
          <div class="section-body">
            <table class="kv">
              {_row("Department", dept_name)}
              {_row("Designation", desig_name)}
              {_row("Role", role_name)}
              {_row("Employment type", emp.EMPLOYMENT_TYPE)}
              {_row("Joining date", _fmt_date(emp.JOINING_DATE))}
              {_row("Confirmation date", _fmt_date(emp.CONFIRMATION_DATE))}
              {_row("Work location", emp.WORK_LOCATION)}
              {_row("Shift", (
                f"{emp.SHIFT_START.strftime('%H:%M')} – {emp.SHIFT_END.strftime('%H:%M')}"
                if emp.SHIFT_START and emp.SHIFT_END else ""
              ))}
            </table>
          </div>
        </div>

        <!-- Education -->
        {'<div class="section">'
         '<div class="section-title">Education</div>'
         f'<div class="section-body"><p>{edu_line}</p></div>'
         '</div>' if edu_line else ""}

        {experience_block}
        {skills_block}
        {notes_block}

      </td>
    </tr>
  </table>

  <div class="footer">
    Generated from the BVC ERP employee master · This document is
    confidential and intended for internal HR use only.
  </div>

</body>
</html>
"""


def build_resume_pdf(db: Session, emp: Employee) -> bytes:
    """Render the resume HTML to PDF bytes via xhtml2pdf."""
    from xhtml2pdf import pisa
    html = build_resume_html(db, emp)
    buf = BytesIO()
    result = pisa.CreatePDF(html, dest=buf)
    if result.err:
        raise RuntimeError("Failed to render employee resume PDF")
    return buf.getvalue()
