"""
Monthly attendance report → PDF (ReportLab).

Independent of the LLM. Renders a single-page A4 summary suitable for
HR to attach to the payslip or share with the employee.
"""

from datetime import date
from pathlib import Path
from typing import Dict, Any
from calendar import month_name


def render_monthly_report_pdf(report: Dict[str, Any],
                              employee_full_name: str,
                              employee_code: str,
                              company_name: str,
                              out_dir: Path) -> Path:

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

    out_dir.mkdir(parents=True, exist_ok=True)
    fname = (f"monthly_report_{employee_code or report['employee_id'][:8]}_"
             f"{report['year']}_{report['month']:02d}.pdf")
    path = out_dir / fname

    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=18*mm, rightMargin=18*mm,
        topMargin=16*mm, bottomMargin=16*mm,
        title=f"Monthly Report — {employee_full_name}",
    )

    styles = getSampleStyleSheet()
    BVC_RED  = colors.HexColor("#C8102E")
    BVC_DARK = colors.HexColor("#7A1022")
    GREY     = colors.HexColor("#64748b")
    LIGHT    = colors.HexColor("#f1f5f9")

    title_s = ParagraphStyle(
        "Title", parent=styles["Heading1"],
        fontName="Helvetica-Bold", fontSize=18,
        textColor=BVC_DARK, alignment=TA_LEFT, spaceAfter=2,
    )
    eyebrow_s = ParagraphStyle(
        "Eyebrow", parent=styles["Normal"],
        fontName="Helvetica-Bold", fontSize=8, textColor=GREY,
        alignment=TA_LEFT, spaceAfter=2, leading=10,
    )
    sub_s = ParagraphStyle(
        "Sub", parent=styles["Normal"],
        fontName="Helvetica", fontSize=10, textColor=GREY,
        alignment=TA_LEFT, spaceAfter=8, leading=12,
    )
    section_s = ParagraphStyle(
        "Section", parent=styles["Heading2"],
        fontName="Helvetica-Bold", fontSize=11, textColor=BVC_RED,
        alignment=TA_LEFT, spaceBefore=10, spaceAfter=6, leading=13,
    )
    note_s = ParagraphStyle(
        "Note", parent=styles["Normal"],
        fontName="Helvetica", fontSize=9, textColor=colors.black,
        leading=13, spaceAfter=3,
    )

    body = []

    body.append(Paragraph(
        f"{company_name.upper()} &nbsp;·&nbsp; MONTHLY EMPLOYEE REPORT",
        eyebrow_s
    ))
    body.append(Paragraph(
        f"{month_name[report['month']]} {report['year']}", title_s
    ))
    body.append(Paragraph(
        f"<b>{employee_full_name}</b> &nbsp;·&nbsp; "
        f"Employee ID: {employee_code or report['employee_id']}",
        sub_s
    ))

    # ---- Day counts table ---------------------------------------------------
    body.append(Paragraph("Attendance summary", section_s))
    summary_data = [
        ["Total days in month",       f"{report['total_days']}",
         "Sundays",                   f"{report['sundays']}"],
        ["Company holidays",          f"{report['holidays']}",
         "Working days",              f"{report['working_days']}"],
        ["Present days",              f"{report['present_days']:.1f}",
         "Absent days",               f"{report['absent_days']:.1f}"],
        ["Late arrivals",             f"{report['late_count']}",
         "Half days",                 f"{report['half_days']:.1f}"],
        ["Worked hours",              f"{report['worked_hours']:.1f}",
         "Overtime hours",            f"{report['overtime_hours']:.1f}"],
        ["Expected hours",            f"{report['expected_hours']:.0f}",
         "Hour compliance",           f"{report['hour_compliance_pct']:.0f}%"],
        ["Attendance %",              f"{report['attendance_pct']:.1f}%",
         "",                          ""],
    ]
    t = Table(summary_data, colWidths=[42*mm, 35*mm, 42*mm, 35*mm])
    t.setStyle(TableStyle([
        ("FONT",       (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT",       (0, 0), (0,  -1), "Helvetica-Bold"),
        ("FONT",       (2, 0), (2,  -1), "Helvetica-Bold"),
        ("TEXTCOLOR",  (0, 0), (0,  -1), GREY),
        ("TEXTCOLOR",  (2, 0), (2,  -1), GREY),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",(0, 0), (-1, -1), 6),
        ("TOPPADDING",  (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0),(-1, -1), 4),
        ("BOX",        (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    body.append(t)

    # ---- Leave breakdown ----------------------------------------------------
    body.append(Paragraph("Leave breakdown", section_s))
    leave_data = [
        ["Casual leave used",  f"{report['cl_used']:.1f}",
         "Sick leave used",    f"{report['sick_used']:.1f}"],
        ["Earned leave used",  f"{report['earned_used']:.1f}",
         "Paid leaves total",  f"{report['paid_leaves']:.1f}"],
        ["Unpaid leaves",      f"{report['unpaid_leaves']:.1f}",
         "Excess leaves",      f"{report['excess_leaves']:.1f}"],
    ]
    t2 = Table(leave_data, colWidths=[42*mm, 35*mm, 42*mm, 35*mm])
    t2.setStyle(TableStyle([
        ("FONT",       (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT",       (0, 0), (0, -1),  "Helvetica-Bold"),
        ("FONT",       (2, 0), (2, -1),  "Helvetica-Bold"),
        ("TEXTCOLOR",  (0, 0), (0, -1),  GREY),
        ("TEXTCOLOR",  (2, 0), (2, -1),  GREY),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",(0, 0), (-1, -1), 6),
        ("TOPPADDING",  (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0),(-1, -1), 4),
        ("BOX",        (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    body.append(t2)

    # ---- Salary block -------------------------------------------------------
    body.append(Paragraph("Salary impact", section_s))
    salary_data = [
        ["Monthly salary",       f"INR {report['monthly_salary']:,.2f}"],
        ["Daily wage",           f"INR {report['daily_wage']:,.2f}"],
        ["Absence deduction",    f"INR {report['absence_deduction']:,.2f}"],
        ["Late-arrival deduction", f"INR {report['late_deduction']:,.2f}"],
        ["Overtime payable",     f"INR {report['ot_payable']:,.2f}"],
    ]
    t3 = Table(salary_data, colWidths=[80*mm, 74*mm])
    t3.setStyle(TableStyle([
        ("FONT",       (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT",       (0, 0), (0, -1),  "Helvetica-Bold"),
        ("TEXTCOLOR",  (0, 0), (0, -1),  GREY),
        ("ALIGN",      (1, 0), (1, -1),  "RIGHT"),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",(0, 0), (-1, -1), 6),
        ("TOPPADDING",  (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0),(-1, -1), 4),
        ("BOX",        (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    body.append(t3)

    net_payable = report.get("net_payable") or 0.0
    net_table = Table(
        [[Paragraph(
            f"<font color='white' size='9'><b>NET PAYABLE</b></font>",
            ParagraphStyle("white", parent=styles["Normal"],
                           textColor=colors.white))],
         [Paragraph(
            f"<font color='white' size='16'><b>INR {net_payable:,.2f}</b></font>",
            ParagraphStyle("whiteBig", parent=styles["Normal"],
                           textColor=colors.white))]],
        colWidths=[154*mm],
    )
    net_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BVC_RED),
        ("ALIGN",      (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",(0, 0), (-1, -1), 12),
        ("TOPPADDING",  (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0),(-1, -1), 8),
    ]))
    body.append(Spacer(1, 6))
    body.append(net_table)

    # ---- Insights -----------------------------------------------------------
    body.append(Paragraph("Insights for HR", section_s))
    for line in (report.get("insights") or ["No attendance concerns flagged."]):
        body.append(Paragraph("•  " + line, note_s))

    body.append(Spacer(1, 14))
    body.append(Paragraph(
        f"<font color='#94a3b8' size='8'>Auto-generated by BVC24 ERP on "
        f"{date.today().isoformat()}. This is a system summary; final "
        f"payroll figures may differ after HR review.</font>",
        styles["Normal"]
    ))

    doc.build(body)
    return path
