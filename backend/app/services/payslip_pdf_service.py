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
    """Render a single-page payslip PDF whose layout mirrors the
    on-screen preview: green Net Pay card top-right, clean employee
    summary, side-by-side Earnings + Deductions table, Total Net
    Payable footer, amount in words. Company logo (when present) in
    the top-right of the header card."""

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
            Image as RLImage, HRFlowable,
        )
        from reportlab.lib.units import mm
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    except Exception:
        return f"PAYSLIP {payslip_number}\n".encode("utf-8")

    # Match the preview's palette (mint-green summary card, soft grey
    # borders, ink text). Kept in local vars so the whole layout can
    # be recoloured from one place.
    INK        = colors.HexColor("#0f172a")
    INK2       = colors.HexColor("#334155")
    MUTED      = colors.HexColor("#64748b")
    BORDER     = colors.HexColor("#e2e8f0")
    BORDER_S   = colors.HexColor("#cbd5e1")
    HEADER_BG  = colors.HexColor("#f8fafc")
    GREEN      = colors.HexColor("#059669")
    GREEN_INK  = colors.HexColor("#065f46")
    GREEN_BG   = colors.HexColor("#ecfdf5")
    GREEN_BORDER = colors.HexColor("#6ee7b7")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"Payslip {payslip_number}",
    )

    base = getSampleStyleSheet()

    s_period_label = ParagraphStyle(
        "periodLabel", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, leading=12,
        textColor=MUTED, alignment=TA_RIGHT,
    )
    s_period_value = ParagraphStyle(
        "periodValue", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=15, leading=18,
        textColor=INK, alignment=TA_RIGHT,
    )
    s_section_label = ParagraphStyle(
        "sectionLabel", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=9.5, leading=12,
        textColor=MUTED, spaceAfter=4,
    )
    s_kv_label = ParagraphStyle(
        "kvLabel", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, leading=13, textColor=INK2,
    )
    s_kv_value = ParagraphStyle(
        "kvValue", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK,
    )
    s_green_amount = ParagraphStyle(
        "greenAmount", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=22, leading=26,
        textColor=GREEN_INK,
    )
    s_green_label = ParagraphStyle(
        "greenLabel", parent=base["Normal"],
        fontName="Helvetica", fontSize=9.5, leading=12, textColor=GREEN_INK,
    )
    s_green_row_lbl = ParagraphStyle(
        "greenRowLbl", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, leading=13, textColor=GREEN_INK,
    )
    s_green_row_val = ParagraphStyle(
        "greenRowVal", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK,
        alignment=TA_RIGHT,
    )
    s_footer_lbl = ParagraphStyle(
        "footerLbl", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=INK,
    )
    s_footer_sub = ParagraphStyle(
        "footerSub", parent=base["Normal"],
        fontName="Helvetica", fontSize=9, leading=12, textColor=MUTED,
    )
    s_footer_amt = ParagraphStyle(
        "footerAmt", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=16, leading=20,
        textColor=GREEN_INK, alignment=TA_RIGHT,
    )
    s_words_lbl = ParagraphStyle(
        "wordsLbl", parent=base["Normal"],
        fontName="Helvetica", fontSize=9.5, leading=13, textColor=MUTED,
        alignment=TA_CENTER, spaceBefore=6,
    )
    s_words_val = ParagraphStyle(
        "wordsVal", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK,
        alignment=TA_CENTER,
    )

    story: List = []

    # ============================================================
    # HEADER — logo top-right, pay-period label under it
    # ============================================================
    logo_cell: Any = ""
    # Always prefer the frontend-bundled logo.webp — that's the file
    # the preview + login card use, so all surfaces stay in sync when
    # HR replaces the brand asset. The CompanyMaster.LOGO_URL fallback
    # is kept only for the edge case where the bundled file is missing
    # (e.g. broken tarball); in normal operation we ignore whatever
    # stale image the DB row points at.
    logo_path = None
    repo_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..")
    )
    for candidate in (
        os.path.join(repo_root, "frontend", "dist", "logo.webp"),
        os.path.join(repo_root, "frontend", "public", "logo.webp"),
    ):
        if os.path.exists(candidate):
            logo_path = candidate
            break

    # Last-resort fallback to CompanyMaster.LOGO_URL only if the
    # bundled file is missing.
    if not logo_path:
        db_logo = (company or {}).get("logo_path")
        if db_logo and os.path.exists(db_logo):
            logo_path = db_logo

    if logo_path and os.path.exists(logo_path):
        try:
            img = RLImage(logo_path, width=22 * mm, height=22 * mm)
            img.hAlign = "RIGHT"
            logo_cell = img
        except Exception:
            logo_cell = ""

    period_block = [
        [logo_cell],
        [Paragraph("Payslip For the Month", s_period_label)],
        [Paragraph(f"{_month_name(pay_month)} {pay_year}", s_period_value)],
    ]
    period_tbl = Table(period_block, colWidths=[60 * mm])
    period_tbl.setStyle(TableStyle([
        ("ALIGN",       (0, 0), (-1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",(0, 0), (-1, -1), 0),
        ("TOPPADDING",  (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ("VALIGN",      (0, 0), (-1, -1), "TOP"),
    ]))

    # Left cell — legal name + multi-line postal address. Same fields
    # the preview reads, so preview + PDF stay in sync.
    s_letterhead_name = ParagraphStyle(
        "letterheadName", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=INK,
    )
    s_letterhead_addr = ParagraphStyle(
        "letterheadAddr", parent=base["Normal"],
        fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=MUTED,
    )

    company_name = (
        (company or {}).get("legal_name")
        or (company or {}).get("name")
        or "Bharath Vending Corporation"
    )
    # Build the address block from the same fields _format_company_address
    # returns in the API — kept here so the PDF works even when called
    # from paths that don't route through employee_payslips.
    addr_parts = []
    if (company or {}).get("address_line_1"):
        addr_parts.append(str(company["address_line_1"]).strip().rstrip(",") + ",")
    if (company or {}).get("address_line_2"):
        addr_parts.append(str(company["address_line_2"]).strip().rstrip(",") + ",")
    city_bits = []
    if (company or {}).get("city"):
        city_bits.append(str(company["city"]).strip())
    if (company or {}).get("pincode"):
        city_bits.append("- " + str(company["pincode"]).strip())
    if city_bits:
        addr_parts.append(" ".join(city_bits) + ".")
    tail_bits = []
    if (company or {}).get("state"):
        tail_bits.append(str(company["state"]).strip())
    if (company or {}).get("country"):
        tail_bits.append(str(company["country"]).strip())
    if tail_bits:
        addr_parts.append(", ".join(tail_bits) + ".")

    letterhead_rows = [[Paragraph(company_name, s_letterhead_name)]]
    for ln in addr_parts:
        letterhead_rows.append([Paragraph(ln, s_letterhead_addr)])

    letterhead_tbl = Table(letterhead_rows, colWidths=[120 * mm])
    letterhead_tbl.setStyle(TableStyle([
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 1),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
    ]))

    header = Table(
        [[letterhead_tbl, period_tbl]],
        colWidths=[120 * mm, 60 * mm],
    )
    header.setStyle(TableStyle([
        ("VALIGN",      (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",(0, 0), (-1, -1), 0),
        ("TOPPADDING",  (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
    ]))
    story.append(header)
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=10))

    # ============================================================
    # EMPLOYEE SUMMARY (left) + NET PAY green card (right)
    # ============================================================
    def _kv(label: str, value: str):
        return [
            Paragraph(label, s_kv_label),
            Paragraph(":", s_kv_label),
            Paragraph(value or "—", s_kv_value),
        ]

    emp_summary_rows = [
        [Paragraph("EMPLOYEE SUMMARY", s_section_label), "", ""],
        _kv("Employee Name", employee.get("NAME") or "—"),
        _kv("Employee ID",   employee.get("CODE") or "—"),
        _kv("Department",    employee.get("DEPARTMENT") or "—"),
        _kv("Pay Period",    f"{_month_name(pay_month)} {pay_year}"),
        _kv("Pay Date",      _fmt_date(generated_at) if generated_at else "—"),
    ]
    emp_summary_tbl = Table(emp_summary_rows, colWidths=[40 * mm, 5 * mm, 45 * mm])
    emp_summary_tbl.setStyle(TableStyle([
        ("SPAN",         (0, 0), (-1, 0)),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 1), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, 0), 10),
    ]))

    # Green Net Pay card — big number, then Paid Days + LOP Days
    paid_days = attendance.get("PRESENT")
    if paid_days is None:
        paid_days = attendance.get("PAID") or 0
    lop_days = attendance.get("LOP") or 0

    net_card_inner_rows = [
        [Paragraph(f"Rs. {_inr(net)}", s_green_amount)],
        [Paragraph("Total Net Pay", s_green_label)],
        [HRFlowable(width="100%", thickness=0.5, color=GREEN_BORDER, spaceBefore=6, spaceAfter=6)],
        [Table(
            [[Paragraph("Paid Days", s_green_row_lbl), Paragraph(":", s_green_row_lbl),
              Paragraph(str(paid_days), s_green_row_val)],
             [Paragraph("LOP Days",  s_green_row_lbl), Paragraph(":", s_green_row_lbl),
              Paragraph(str(lop_days), s_green_row_val)]],
            colWidths=[24 * mm, 5 * mm, 24 * mm],
            style=TableStyle([
                ("LEFTPADDING",  (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING",   (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
            ])
        )],
    ]
    net_card = Table(net_card_inner_rows, colWidths=[60 * mm])
    net_card.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), GREEN_BG),
        ("BOX",          (0, 0), (-1, -1), 1.4, GREEN),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING",   (0, 0), (-1, 0), 12),
        ("BOTTOMPADDING",(0, -1), (-1, -1), 12),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
    ]))

    top_grid = Table(
        [[emp_summary_tbl, net_card]],
        colWidths=[105 * mm, 72 * mm],
    )
    top_grid.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(top_grid)
    story.append(Spacer(1, 16))

    # ============================================================
    # EARNINGS + DEDUCTIONS — side-by-side table
    # ============================================================
    earn_visible = [(k, float(v)) for k, v in earnings.items() if v and abs(float(v)) >= 0.01]
    ded_visible  = [(k, float(v)) for k, v in deductions.items() if v and abs(float(v)) >= 0.01]

    # Pad to equal row count so both columns align at the bottom.
    row_count = max(len(earn_visible), len(ded_visible))
    while len(earn_visible) < row_count:
        earn_visible.append(("", 0.0))
    while len(ded_visible) < row_count:
        ded_visible.append(("", 0.0))

    table_rows = [
        ["EARNINGS", "AMOUNT", "DEDUCTIONS", "AMOUNT"],
    ]
    for (el, ev), (dl, dv) in zip(earn_visible, ded_visible):
        table_rows.append([
            el, _inr(ev) if el else "",
            dl, _inr(dv) if dl else "",
        ])
    # Gross Earnings + Total Deductions footer
    table_rows.append(["Gross Earnings", _inr(gross), "Total Deductions", _inr(total_deductions)])

    ed_table = Table(
        table_rows,
        colWidths=[54 * mm, 34 * mm, 54 * mm, 34 * mm],
    )
    last = len(table_rows) - 1
    ed_table.setStyle(TableStyle([
        # Border + grid
        ("BOX",          (0, 0), (-1, -1), 0.8, BORDER_S),
        ("LINEBELOW",    (0, 0), (-1, 0), 0.8, BORDER_S),
        ("LINEBEFORE",   (2, 0), (2, -1), 0.8, BORDER_S),
        # Header row
        ("BACKGROUND",   (0, 0), (-1, 0), HEADER_BG),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 9),
        ("TEXTCOLOR",    (0, 0), (-1, 0), MUTED),
        ("ALIGN",        (1, 0), (1, 0), "RIGHT"),
        ("ALIGN",        (3, 0), (3, 0), "RIGHT"),
        # Body
        ("FONTNAME",     (0, 1), (-1, -2), "Helvetica"),
        ("FONTSIZE",     (0, 1), (-1, -2), 10),
        ("TEXTCOLOR",    (0, 1), (-1, -2), INK2),
        ("ALIGN",        (1, 1), (1, -2), "RIGHT"),
        ("ALIGN",        (3, 1), (3, -2), "RIGHT"),
        # Footer row (Gross / Total)
        ("FONTNAME",     (0, last), (-1, last), "Helvetica-Bold"),
        ("FONTSIZE",     (0, last), (-1, last), 10.5),
        ("BACKGROUND",   (0, last), (-1, last), HEADER_BG),
        ("TEXTCOLOR",    (0, last), (-1, last), INK),
        ("ALIGN",        (1, last), (1, last), "RIGHT"),
        ("ALIGN",        (3, last), (3, last), "RIGHT"),
        ("LINEABOVE",    (0, last), (-1, last), 0.6, BORDER_S),
        # Padding
        ("LEFTPADDING",  (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(ed_table)
    story.append(Spacer(1, 14))

    # ============================================================
    # TOTAL NET PAYABLE footer bar (green, right-aligned amount card)
    # ============================================================
    net_footer_left = Table(
        [
            [Paragraph("TOTAL NET PAYABLE", s_footer_lbl)],
            [Paragraph("Gross Earnings - Total Deductions", s_footer_sub)],
        ],
        colWidths=[110 * mm],
    )
    net_footer_left.setStyle(TableStyle([
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
    ]))

    net_amt_box = Table(
        [[Paragraph(f"Rs. {_inr(net)}", s_footer_amt)]],
        colWidths=[62 * mm],
    )
    net_amt_box.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), GREEN_BG),
        ("BOX",          (0, 0), (-1, -1), 1.2, GREEN),
        ("LEFTPADDING",  (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING",   (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 12),
    ]))

    net_footer = Table(
        [[net_footer_left, net_amt_box]],
        colWidths=[113 * mm, 65 * mm],
    )
    net_footer.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("BOX",          (0, 0), (-1, -1), 0.8, BORDER_S),
        ("LEFTPADDING",  (0, 0), (0, 0), 14),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
    ]))
    story.append(net_footer)

    # ============================================================
    # AMOUNT IN WORDS
    # ============================================================
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph("Amount In Words:", s_words_lbl))
    story.append(Paragraph(amount_in_words(net), s_words_val))

    # ============================================================
    # FOOTER
    # ============================================================
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=6))
    story.append(Paragraph(
        f"Payslip #: <b>{payslip_number}</b>. This is a system-generated payslip "
        f"and does not require a signature.",
        s_footer_sub,
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
