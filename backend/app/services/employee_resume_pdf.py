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


def _file_data_uri(path: Path) -> str:
    """Inline any local image file as a base64 data URI so the PDF
    is self-contained. Returns '' when the file is missing or the
    extension isn't a supported raster type (xhtml2pdf can't handle
    .webp reliably — we let those fall through to the placeholder)."""
    if not path or not path.exists():
        return ""
    try:
        import base64
        ext = (path.suffix.lower().lstrip(".") or "jpg")
        if ext == "jpg":
            mime = "image/jpeg"
        elif ext in ("jpeg", "png", "gif"):
            mime = f"image/{'jpeg' if ext == 'jpeg' else ext}"
        else:
            return ""
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{data}"
    except Exception:
        return ""


def _photo_data_uri(photo_url: Optional[str]) -> str:
    """Read the local photo file (if any) and inline as base64 so the
    PDF stays self-contained. Returns an empty string when no photo."""
    if not photo_url:
        return ""
    _here = Path(__file__).resolve().parent  # backend/app/services
    backend_root = _here.parent.parent       # backend/
    rel = str(photo_url).lstrip("/")         # static/employee/xxx.jpg
    return _file_data_uri(backend_root / rel)


def _company_logo_data_uri() -> str:
    """Inline the BVC company logo at backend/app/assets/bharath-logo.png
    so the header shows a real logo instead of a placeholder."""
    _here = Path(__file__).resolve().parent  # backend/app/services
    backend_root = _here.parent.parent       # backend/
    return _file_data_uri(backend_root / "app" / "assets" / "bharath-logo.png")


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
        # xhtml2pdf renders inline-block spans as glued-together text,
        # so build a small wrapping table where each skill sits in its
        # own cell — that gives us reliable spacing + wrapping.
        skill_items = [s.strip() for s in str(emp.SKILLS).split(",") if s.strip()]
        # 3 pills per row (fits comfortably in the right column).
        rows_html = ""
        per_row = 3
        for i in range(0, len(skill_items), per_row):
            chunk = skill_items[i : i + per_row]
            cells = "".join(
                f'<td class="skill-cell">{_esc(s)}</td>'
                for s in chunk
            )
            # Pad the last row so all cells stay uniform-width.
            while len(chunk) < per_row:
                cells += '<td class="skill-cell-empty">&nbsp;</td>'
                chunk.append("")
            rows_html += f'<tr>{cells}</tr>'
        if rows_html:
            skills_block = (
                '<div class="section">'
                '<div class="section-title">Skills</div>'
                '<div class="section-body">'
                f'<table class="skills-tbl"><tbody>{rows_html}</tbody></table>'
                '</div></div>'
            )

    notes_block = ""
    if emp.NOTES:
        notes_block = (
            '<div class="section">'
            '<div class="section-title">Notes</div>'
            f'<div class="section-body"><p>{_esc(emp.NOTES)}</p></div>'
            '</div>'
        )

    # Only render the avatar column when a real photo exists.
    # No photo -> no initials placeholder either; the name block
    # takes the full row width.
    photo_html = f'<img class="avatar" src="{photo}" />' if photo else ""

    subtitle_parts = []
    if desig_name: subtitle_parts.append(_esc(desig_name))
    if dept_name:  subtitle_parts.append(_esc(dept_name))
    subtitle = " &middot; ".join(subtitle_parts) or "&nbsp;"

    logo = _company_logo_data_uri()
    logo_html = (
        f'<img src="{logo}" width="46" height="46" />'
        if logo else
        '<div class="logo-fallback">BVC</div>'
    )

    return f"""
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Employee Profile — {_esc(emp.NAME or emp.EMPLOYEE_CODE)}</title>
<style>
  @page {{
    size: A4;
    margin: 16mm 16mm 16mm 16mm;
  }}
  body {{
    font-family: Helvetica, Arial, sans-serif;
    color: #0f172a;
    font-size: 10pt;
    line-height: 1.45;
  }}

  /* ---------- Company band (very top) ---------- */
  .company-band {{
    width: 100%;
    border-bottom: 3px solid #C8102E;
    padding-bottom: 8px;
    margin-bottom: 14px;
  }}
  .company-tbl {{ width: 100%; border-collapse: collapse; }}
  .company-tbl td {{ vertical-align: middle; padding: 0; }}
  .company-name {{
    font-size: 14pt;
    font-weight: bold;
    color: #C8102E;
    letter-spacing: 0.3pt;
    margin: 0;
  }}
  .company-tag {{
    font-size: 8.5pt;
    color: #64748b;
    letter-spacing: 1.6pt;
    text-transform: uppercase;
    margin-top: 2px;
  }}
  .doc-kind {{
    font-size: 8.5pt;
    color: #64748b;
    text-align: right;
    letter-spacing: 1.4pt;
    text-transform: uppercase;
  }}
  .logo-fallback {{
    width: 46px; height: 46px;
    background: #C8102E;
    color: white;
    text-align: center;
    line-height: 46px;
    font-weight: bold;
    font-size: 12pt;
    letter-spacing: 1pt;
  }}

  /* ---------- Employee header ---------- */
  .emp-header {{
    padding-bottom: 12px;
    margin-bottom: 14px;
    border-bottom: 1px solid #e5e7eb;
  }}
  .emp-header-tbl {{ width: 100%; border-collapse: collapse; }}
  .emp-header-tbl td {{ vertical-align: middle; padding: 0; }}
  .avatar {{
    width: 74px; height: 74px;
    border: 1px solid #e5e7eb;
  }}
  .avatar-initials {{
    width: 74px; height: 74px;
    line-height: 74px;
    text-align: center;
    background: #C8102E;
    color: white;
    font-size: 26pt;
    font-weight: bold;
  }}
  .name-block {{ padding-left: 16px; }}
  .name {{
    font-size: 20pt;
    font-weight: bold;
    color: #0f172a;
    margin: 0 0 2px 0;
    letter-spacing: -0.3pt;
  }}
  .subtitle {{
    font-size: 10.5pt;
    color: #475569;
    margin-bottom: 6px;
  }}
  .emp-code {{
    padding: 2px 8px;
    background: #fee2e2;
    color: #C8102E;
    font-size: 8.5pt;
    font-weight: bold;
    letter-spacing: 0.5pt;
  }}
  .status-pill {{
    padding: 2px 8px;
    background: #dcfce7;
    color: #166534;
    font-size: 8.5pt;
    font-weight: bold;
    letter-spacing: 0.5pt;
    margin-left: 4px;
  }}

  /* ---------- Two-column body ---------- */
  .cols {{ width: 100%; border-collapse: collapse; }}
  .cols > tbody > tr > td {{
    width: 50%;
    vertical-align: top;
  }}
  .cols > tbody > tr > td.first {{ padding-right: 10px; }}
  .cols > tbody > tr > td.second {{ padding-left: 10px; }}

  .section {{ margin-bottom: 12px; }}
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
  .section-body p {{ margin: 0 0 4px 0; }}

  /* Label / value alignment rows */
  .kv {{ width: 100%; border-collapse: collapse; }}
  .kv td {{ padding: 2px 0; vertical-align: top; }}
  .kv td.lbl {{
    width: 42%;
    color: #64748b;
    font-size: 9.5pt;
  }}
  .kv td.val {{
    color: #0f172a;
    font-size: 10pt;
    font-weight: bold;
  }}

  /* Skills as a 3-cell wrap grid — reliable in xhtml2pdf */
  .skills-tbl {{
    width: 100%;
    border-collapse: separate;
    border-spacing: 4px;
  }}
  .skill-cell {{
    background: #f1f5f9;
    border: 1px solid #e5e7eb;
    color: #0f172a;
    font-size: 9.5pt;
    padding: 4px 8px;
    text-align: center;
  }}
  .skill-cell-empty {{
    background: transparent;
    border: none;
  }}

  .footer {{
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
    color: #94a3b8;
    font-size: 8pt;
    text-align: center;
  }}
</style>
</head>
<body>

  <!-- ============ COMPANY BAND ============ -->
  <div class="company-band">
    <table class="company-tbl">
      <tr>
        <td width="55">{logo_html}</td>
        <td>
          <div class="company-name">BHARATH VENDING CORPORATION</div>
          <div class="company-tag">Employee Master · Confidential</div>
        </td>
        <td class="doc-kind" width="140">
          Employee Profile
        </td>
      </tr>
    </table>
  </div>

  <!-- ============ EMPLOYEE HEADER ============ -->
  <div class="emp-header">
    <table class="emp-header-tbl">
      <tr>
        {f'<td width="80">{photo_html}</td>' if photo_html else ''}
        <td class="name-block" {'style="padding-left:0"' if not photo_html else ''}>
          <div class="name">{_esc(emp.NAME or "—")}</div>
          <div class="subtitle">{subtitle}</div>
          <span class="emp-code">{_esc(emp.EMPLOYEE_CODE or "—")}</span>
          <span class="status-pill">{_esc(emp.STATUS or "—")}</span>
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
