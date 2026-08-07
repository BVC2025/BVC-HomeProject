"""
Payslip PDF renderer — corporate-grade letterhead with company logo,
employee block, earnings + deductions tables, net-pay summary and
amount-in-words. Same visual language as the offer letter so the
brand stays consistent across HR documents.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional, Dict, Any, List
import io
import os
import json


_MONTHS = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _month_name(m: int) -> str:
    return _MONTHS[m] if isinstance(m, int) and 1 <= m <= 12 else "?"


def _inr(n) -> str:
    """Format with the Indian thousand-grouping (1,23,456.78)."""
    try:
        n = float(n)
    except Exception:
        return "0.00"
    s = f"{n:.2f}"
    int_part, dec_part = s.split(".")
    sign = ""
    if int_part.startswith("-"):
        sign = "-"
        int_part = int_part[1:]
    if len(int_part) <= 3:
        grouped = int_part
    else:
        last3 = int_part[-3:]
        rest  = int_part[:-3]
        # Group remaining digits in pairs from the right (Indian style).
        chunks: List[str] = []
        while len(rest) > 2:
            chunks.append(rest[-2:])
            rest = rest[:-2]
        if rest:
            chunks.append(rest)
        chunks.reverse()
        grouped = ",".join(chunks) + "," + last3
    return f"{sign}{grouped}.{dec_part}"


# ============================================================
# Number to words (Indian English — lakh / crore)
# ============================================================

_ONES = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen",
]
_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety",
]


def _two_digit_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    t, o = divmod(n, 10)
    if o == 0:
        return _TENS[t]
    return f"{_TENS[t]} {_ONES[o]}"


def _three_digit_words(n: int) -> str:
    if n == 0:
        return ""
    h, r = divmod(n, 100)
    parts: List[str] = []
    if h:
        parts.append(f"{_ONES[h]} hundred")
    if r:
        if parts:
            parts.append("and")
        parts.append(_two_digit_words(r))
    return " ".join(parts)


def amount_in_words(amount) -> str:
    """Convert a positive numeric amount to Indian-English words.
    Example: 152340.50 -> "One lakh fifty-two thousand three hundred
    and forty rupees and fifty paise only"."""
    try:
        amt = float(amount)
    except Exception:
        return ""
    rupees = int(amt)
    paise  = round((amt - rupees) * 100)

    if rupees == 0 and paise == 0:
        return "Zero rupees only"

    # Indian breakdown: crore -> lakh -> thousand -> hundred -> rest
    crore, rem = divmod(rupees, 10_000_000)
    lakh,  rem = divmod(rem, 100_000)
    thou,  rem = divmod(rem, 1_000)
    hund        = rem

    parts: List[str] = []
    if crore: parts.append(f"{_two_digit_words(crore)} crore")
    if lakh:  parts.append(f"{_two_digit_words(lakh)} lakh")
    if thou:  parts.append(f"{_two_digit_words(thou)} thousand")
    if hund:  parts.append(_three_digit_words(hund))

    words = " ".join(parts).strip() or "zero"
    words = words[0].upper() + words[1:] + " rupees"
    if paise > 0:
        words += f" and {_two_digit_words(paise)} paise"
    return words + " only"


# ============================================================
# Render
# ============================================================

def render_payslip_pdf(
    *,
    payslip_number: str,
    pay_year: int,
    pay_month: int,
    generated_at: Optional[datetime],
    employee: Dict[str, Any],     # NAME, CODE, DEPARTMENT, DESIGNATION, JOINING_DATE, BANK_ACCOUNT, PAN
    attendance: Dict[str, Any],   # WORKING_DAYS, PRESENT, LEAVE, LOP, ABSENT
    earnings:   Dict[str, float], # label -> amount (only non-zero are shown)
    deductions: Dict[str, float], # label -> amount
    gross: float,
    total_deductions: float,
    net: float,
    company: Dict[str, Any],
) -> bytes:
    """Render a single-page payslip PDF and return the bytes."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
            Image as RLImage, KeepTogether, HRFlowable,
        )
        from reportlab.lib.units import mm
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    except Exception:
        return f"PAYSLIP {payslip_number}\n".encode("utf-8")

    BVC_RED  = colors.HexColor("#C8102E")
    BVC_DARK = colors.HexColor("#7A1022")
    GREY     = colors.HexColor("#475569")
    LIGHT    = colors.HexColor("#f1f5f9")
    GOLD     = colors.HexColor("#F4B324")
    INK      = colors.HexColor("#1a1a1a")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=14 * mm, bottomMargin=14 * mm,
        title=f"Payslip {payslip_number}",
    )

    base = getSampleStyleSheet()
    s_company = ParagraphStyle(
        "company", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=13, leading=15,
        textColor=BVC_DARK, spaceAfter=0,
    )
    s_company_sub = ParagraphStyle(
        "companySub", parent=base["Normal"],
        fontName="Helvetica", fontSize=8.5, leading=11,
        textColor=GREY,
    )
    s_title = ParagraphStyle(
        "title", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=13, leading=16,
        alignment=TA_CENTER, textColor=BVC_DARK,
        spaceBefore=4, spaceAfter=2,
    )
    s_period = ParagraphStyle(
        "period", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, leading=12,
        alignment=TA_CENTER, textColor=GREY, spaceAfter=8,
    )
    s_label = ParagraphStyle(
        "label", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, leading=12,
        textColor=BVC_DARK, spaceBefore=8, spaceAfter=4,
    )
    s_body = ParagraphStyle(
        "body", parent=base["Normal"],
        fontName="Helvetica", fontSize=9.5, leading=12, textColor=INK,
    )
    s_small = ParagraphStyle(
        "small", parent=base["Normal"],
        fontName="Helvetica", fontSize=8.5, leading=11, textColor=GREY,
    )
    s_words = ParagraphStyle(
        "words", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, leading=14,
        textColor=BVC_DARK,
    )

    story: List = []

    # ============================================================
    # LETTERHEAD
    # ============================================================
    logo_path = (company or {}).get("logo_path")
    logo_cell = ""
    if logo_path and os.path.exists(logo_path):
        try:
            img = RLImage(logo_path, width=26 * mm, height=26 * mm)
            img.hAlign = "LEFT"
            logo_cell = img
        except Exception:
            logo_cell = ""

    legal_name = company.get("legal_name") or company.get("name") or "Bharath Vending Corporation"
    addr_lines = []
    if company.get("address_line_1"): addr_lines.append(company["address_line_1"])
    if company.get("address_line_2"): addr_lines.append(company["address_line_2"])
    city_line = ", ".join(filter(None, [
        company.get("city"), company.get("state"), company.get("pincode"),
    ]))
    if city_line: addr_lines.append(city_line)
    contact = []
    if company.get("phone"):   contact.append(company["phone"])
    if company.get("email"):   contact.append(company["email"])
    if contact: addr_lines.append(" &nbsp;·&nbsp; ".join(contact))
    statutory = []
    if company.get("gst_number"): statutory.append(f"GSTIN: {company['gst_number']}")
    if company.get("pan_number"): statutory.append(f"PAN: {company['pan_number']}")
    if statutory: addr_lines.append(" &nbsp;·&nbsp; ".join(statutory))

    right_lines = [Paragraph(legal_name, s_company)]
    for ln in addr_lines:
        right_lines.append(Paragraph(ln, s_company_sub))

    head = Table([[logo_cell, right_lines]], colWidths=[32 * mm, 140 * mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(head)
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=2, color=BVC_RED,
                           spaceBefore=2, spaceAfter=4))
    story.append(HRFlowable(width="100%", thickness=1, color=GOLD,
                           spaceBefore=0, spaceAfter=8))

    # ============================================================
    # TITLE
    # ============================================================
    story.append(Paragraph("SALARY PAYSLIP", s_title))
    gen_text = ""
    if generated_at:
        gen_text = f" &nbsp;·&nbsp; Generated: {generated_at.strftime('%d %b %Y')}"
    story.append(Paragraph(
        f"Payslip #: <b>{payslip_number}</b> &nbsp;·&nbsp; "
        f"Pay Period: {_month_name(pay_month)} {pay_year}{gen_text}",
        s_period,
    ))

    # ============================================================
    # EMPLOYEE + ATTENDANCE — two-column table
    # ============================================================
    emp_left = [
        ["Employee ID",   employee.get("CODE") or "—"],
        ["Name",          employee.get("NAME") or "—"],
        ["Department",    employee.get("DEPARTMENT") or "—"],
        ["Designation",   employee.get("DESIGNATION") or "—"],
        ["Date of Joining", _fmt_date(employee.get("JOINING_DATE"))],
        ["Bank A/C",      employee.get("BANK_ACCOUNT") or "—"],
        ["PAN",           employee.get("PAN") or "—"],
    ]
    att_right = [
        ["Working Days", str(attendance.get("WORKING_DAYS") or "—")],
        ["Present Days", str(attendance.get("PRESENT") or 0)],
        ["Leave Days",   str(attendance.get("LEAVE")   or 0)],
        ["LOP Days",     str(attendance.get("LOP")     or 0)],
        ["Absent Days",  str(attendance.get("ABSENT")  or 0)],
        ["Late Marks",   str(attendance.get("LATE")    or 0)],
        ["OT Hours",     str(attendance.get("OT_HOURS") or 0)],
    ]

    detail_rows = [
        [
            _style_two_col_table(emp_left,  GREY, INK, LIGHT),
            _style_two_col_table(att_right, GREY, INK, LIGHT),
        ]
    ]
    detail = Table(detail_rows, colWidths=[90 * mm, 80 * mm])
    detail.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(detail)

    # ============================================================
    # EARNINGS + DEDUCTIONS — side-by-side
    # ============================================================
    story.append(Spacer(1, 8))

    earn_rows = [["Earnings", "Amount (INR)"]]
    earn_sum  = 0.0
    for label, val in earnings.items():
        if val is None: continue
        if abs(float(val)) < 0.01: continue   # skip zero rows
        earn_rows.append([label, _inr(val)])
        earn_sum += float(val)
    earn_rows.append(["Gross Earnings", _inr(gross)])
    earn_table = _ledger_table(earn_rows, BVC_DARK, LIGHT)

    ded_rows = [["Deductions", "Amount (INR)"]]
    ded_sum  = 0.0
    for label, val in deductions.items():
        if val is None: continue
        if abs(float(val)) < 0.01: continue
        ded_rows.append([label, _inr(val)])
        ded_sum += float(val)
    ded_rows.append(["Total Deductions", _inr(total_deductions)])
    ded_table = _ledger_table(ded_rows, BVC_DARK, LIGHT)

    side_by_side = Table(
        [[earn_table, ded_table]],
        colWidths=[88 * mm, 88 * mm],
    )
    side_by_side.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(side_by_side)

    # ============================================================
    # NET PAY summary box
    # ============================================================
    story.append(Spacer(1, 10))

    net_table = Table(
        [
            ["Gross Earnings",     _inr(gross)],
            ["Total Deductions",   _inr(total_deductions)],
            ["NET PAY",            _inr(net)],
        ],
        colWidths=[110 * mm, 55 * mm],
    )
    net_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -2), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TEXTCOLOR", (0, 0), (0, -2), GREY),
        # Last row — emphasized
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), BVC_DARK),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
        ("FONTSIZE", (0, -1), (-1, -1), 12),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    story.append(net_table)

    # ============================================================
    # AMOUNT IN WORDS
    # ============================================================
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"<b>Amount in words:</b> {amount_in_words(net)}",
        s_words,
    ))

    # ============================================================
    # FOOTER
    # ============================================================
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5,
                           color=colors.HexColor("#cbd5e1"),
                           spaceBefore=2, spaceAfter=4))
    story.append(Paragraph(
        "This is a system-generated payslip and does not require a signature. "
        f"For any clarifications, contact <b>{company.get('email') or 'HR'}</b>.",
        s_small,
    ))

    doc.build(story)
    return buf.getvalue()


# ============================================================
# Internal table helpers
# ============================================================

def _style_two_col_table(rows: List[List[str]], label_color, value_color, label_bg):
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors
    t = Table(rows, colWidths=[38 * 2.83465, 50 * 2.83465])   # mm -> pt
    # Recompute colWidths in mm — reportlab default units are pt; use the unit constant
    from reportlab.lib.units import mm
    t = Table(rows, colWidths=[35 * mm, 50 * mm])
    t.setStyle(TableStyle([
        ("FONTNAME",  (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME",  (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE",  (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), label_color),
        ("TEXTCOLOR", (1, 0), (1, -1), value_color),
        ("BACKGROUND",(0, 0), (0, -1), label_bg),
        ("BOX",       (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _ledger_table(rows: List[List[str]], header_bg, footer_bg):
    """Two-column ledger (label / amount) with styled header + footer rows."""
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    last = len(rows) - 1
    t = Table(rows, colWidths=[55 * mm, 30 * mm])
    t.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, 0), 9.5),
        ("ALIGN",      (1, 0), (1, -1), "RIGHT"),
        # Body
        ("FONTSIZE",   (0, 1), (-1, -1), 9),
        # Footer
        ("FONTNAME",   (0, last), (-1, last), "Helvetica-Bold"),
        ("BACKGROUND", (0, last), (-1, last), footer_bg),
        ("TEXTCOLOR",  (0, last), (-1, last), header_bg),
        # Grid
        ("BOX",        (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID",  (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING",   (0, 0), (-1, -1), 7),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 7),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _fmt_date(d) -> str:
    if not d: return "—"
    try:
        if isinstance(d, str):
            d = datetime.fromisoformat(d[:10]).date()
        return d.strftime("%d %b %Y")
    except Exception:
        return str(d)
