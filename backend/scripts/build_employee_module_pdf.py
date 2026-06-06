"""
Build a clean, readable PDF from docs/EMPLOYEE_MODULE.md.

No external binaries needed — pure Python (markdown + reportlab + bs4).
Output: docs/EMPLOYEE_MODULE.pdf
"""

import re
from pathlib import Path

import markdown
from bs4 import BeautifulSoup, NavigableString

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
    HRFlowable,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfgen import canvas


# ---------------------------------------------------------------------
# BRAND PALETTE — BVC red + neutrals
# ---------------------------------------------------------------------
BVC_RED       = colors.HexColor("#C8102E")
BVC_RED_DARK  = colors.HexColor("#8B0B1F")
NAVY          = colors.HexColor("#1F2937")
SLATE         = colors.HexColor("#475569")
SOFT_GRAY     = colors.HexColor("#E5E7EB")
LIGHT_GRAY    = colors.HexColor("#F3F4F6")
ROW_ALT       = colors.HexColor("#FAFAFA")
INK           = colors.HexColor("#111827")
MUTED         = colors.HexColor("#6B7280")
CODE_BG       = colors.HexColor("#F3F4F6")
ADMON_BLUE_BG = colors.HexColor("#EFF6FF")
ADMON_BLUE_BR = colors.HexColor("#3B82F6")


# ---------------------------------------------------------------------
# PARAGRAPH STYLES
# ---------------------------------------------------------------------
def build_styles():

    base = getSampleStyleSheet()["BodyText"]

    body = ParagraphStyle(
        "Body",
        parent=base,
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        textColor=INK,
        spaceBefore=2,
        spaceAfter=4,
    )

    body_small = ParagraphStyle(
        "BodySmall",
        parent=body,
        fontSize=9,
        leading=12,
    )

    muted = ParagraphStyle(
        "Muted",
        parent=body,
        textColor=MUTED,
        fontSize=9,
        leading=12,
    )

    h1 = ParagraphStyle(
        "H1",
        parent=base,
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=BVC_RED,
        spaceBefore=18,
        spaceAfter=12,
        keepWithNext=1,
    )

    h2 = ParagraphStyle(
        "H2",
        parent=base,
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=19,
        textColor=NAVY,
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=1,
    )

    h3 = ParagraphStyle(
        "H3",
        parent=base,
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=BVC_RED_DARK,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=1,
    )

    h4 = ParagraphStyle(
        "H4",
        parent=base,
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13,
        textColor=NAVY,
        spaceBefore=8,
        spaceAfter=3,
        keepWithNext=1,
    )

    code = ParagraphStyle(
        "Code",
        parent=base,
        fontName="Courier",
        fontSize=8.5,
        leading=11,
        textColor=INK,
        leftIndent=8,
        rightIndent=8,
        spaceBefore=4,
        spaceAfter=6,
        backColor=CODE_BG,
        borderColor=SOFT_GRAY,
        borderWidth=0.5,
        borderPadding=6,
    )

    li = ParagraphStyle(
        "ListItem",
        parent=body,
        leftIndent=16,
        bulletIndent=4,
        spaceBefore=1,
        spaceAfter=1,
    )

    toc_l1 = ParagraphStyle(
        "TOC1",
        parent=base,
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=15,
        textColor=BVC_RED,
        leftIndent=0,
        spaceBefore=6,
    )

    toc_l2 = ParagraphStyle(
        "TOC2",
        parent=base,
        fontName="Helvetica",
        fontSize=10,
        leading=13,
        textColor=NAVY,
        leftIndent=14,
        spaceBefore=1,
    )

    cover_title = ParagraphStyle(
        "CoverTitle",
        parent=base,
        fontName="Helvetica-Bold",
        fontSize=34,
        leading=42,
        textColor=colors.white,
        alignment=0,  # left
    )

    cover_sub = ParagraphStyle(
        "CoverSub",
        parent=base,
        fontName="Helvetica",
        fontSize=14,
        leading=20,
        textColor=colors.white,
    )

    cover_meta = ParagraphStyle(
        "CoverMeta",
        parent=base,
        fontName="Helvetica",
        fontSize=11,
        leading=16,
        textColor=colors.white,
    )

    quote = ParagraphStyle(
        "Quote",
        parent=body,
        leftIndent=14,
        rightIndent=14,
        textColor=NAVY,
        fontName="Helvetica-Oblique",
        borderColor=ADMON_BLUE_BR,
        borderWidth=0,
        backColor=ADMON_BLUE_BG,
        borderPadding=8,
        spaceBefore=6,
        spaceAfter=8,
    )

    return dict(
        body=body, body_small=body_small, muted=muted,
        h1=h1, h2=h2, h3=h3, h4=h4,
        code=code, li=li,
        toc_l1=toc_l1, toc_l2=toc_l2,
        cover_title=cover_title, cover_sub=cover_sub, cover_meta=cover_meta,
        quote=quote,
    )


# ---------------------------------------------------------------------
# INLINE FORMATTING
# Translate the bs4 element tree of one block into reportlab markup.
# We support: <strong>, <em>, <code>, <a>, plus emoji passthrough.
# ---------------------------------------------------------------------
EMOJI_FALLBACK = {
    "✅": "[OK]",
    "❌": "[X]",
    "⏳": "[~]",
    "⚠️": "[!]",
    "⚠": "[!]",
    "🚫": "[BLOCKED]",
    "⌛": "[EXPIRED]",
    "🤖": "[BOT]",
    "📧": "[EMAIL]",
    "📋": "[LIST]",
    "📡": "[GPS]",
    "📵": "[NO GPS]",
    "⏱": "[TIMEOUT]",
    "👤": "[USER]",
    "🏭": "[FACTORY]",
    "🏢": "[CUSTOMER]",
    "🌴": "[LEAVE]",
    "📈": "[PERF]",
    "👆": "[SCAN]",
    "📊": "[STAGES]",
    "👥": "[PEOPLE]",
    "📦": "[INVENTORY]",
    "🚚": "[SUPPLIER]",
    "★": "*",
    "→": "->",
    "▶": ">",
    "▸": ">",
    "•": "-",
    "·": "-",
    "↑": "^",
    "↓": "v",
    "├": "|-",
    "└": "L",
    "─": "-",
    "│": "|",
    # En/Em dashes — Helvetica WinAnsi can't always render these cleanly
    "—": " - ",
    "–": " - ",
    # Smart quotes
    "“": '"', "”": '"', "‘": "'", "’": "'",
    # Other punctuation
    "…": "...",
    "×": "x",
    "≥": ">=",
    "≤": "<=",
    "≠": "!=",
}


def sanitise_text(s: str) -> str:
    """Replace characters Helvetica/Courier can't render."""
    if not s:
        return ""
    for bad, repl in EMOJI_FALLBACK.items():
        s = s.replace(bad, repl)
    # Strip other non-BMP / unusual chars
    out = []
    for ch in s:
        if ord(ch) < 0x2500 or ch in "·":
            out.append(ch)
        else:
            out.append("")  # drop silently
    return "".join(out)


def escape_xml(s: str) -> str:
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
    )


def inline_to_rl(node):
    """Recursive: convert bs4 inline content to reportlab paragraph markup."""

    if isinstance(node, NavigableString):
        return escape_xml(sanitise_text(str(node)))

    name = node.name

    if name in ("strong", "b"):
        inner = "".join(inline_to_rl(c) for c in node.children)
        return f"<b>{inner}</b>"

    if name in ("em", "i"):
        inner = "".join(inline_to_rl(c) for c in node.children)
        return f"<i>{inner}</i>"

    if name == "code":
        txt = escape_xml(sanitise_text(node.get_text()))
        return f'<font face="Courier" size="9" backColor="#F3F4F6">{txt}</font>'

    if name == "a":
        inner = "".join(inline_to_rl(c) for c in node.children)
        href = node.get("href", "")
        if href.startswith(("http://", "https://")):
            return f'<link href="{escape_xml(href)}" color="#C8102E">{inner}</link>'
        return inner  # internal markdown links rendered as plain text

    if name == "br":
        return "<br/>"

    # Unknown → flatten children
    return "".join(inline_to_rl(c) for c in node.children)


# ---------------------------------------------------------------------
# BLOCK CONVERTERS
# ---------------------------------------------------------------------
SECTION_NUM = 0

def next_section_id():
    global SECTION_NUM
    SECTION_NUM += 1
    return f"sec{SECTION_NUM}"


def block_paragraph(p, styles, style_key="body"):
    text = "".join(inline_to_rl(c) for c in p.children).strip()
    if not text:
        return None
    return Paragraph(text, styles[style_key])


def block_heading(h, level, styles):
    text = "".join(inline_to_rl(c) for c in h.children).strip()
    if not text:
        return None
    key = {1: "h1", 2: "h2", 3: "h3"}.get(level, "h4")
    return Paragraph(text, styles[key])


def block_list(ul_or_ol, styles, ordered=False):
    flows = []
    for i, li in enumerate(ul_or_ol.find_all("li", recursive=False), start=1):
        # Build inline content from li (drop nested ul/ol — handle separately)
        nested = []
        primary_parts = []
        for child in li.children:
            if getattr(child, "name", None) in ("ul", "ol"):
                nested.append(child)
            else:
                primary_parts.append(inline_to_rl(child))
        primary = "".join(primary_parts).strip()
        bullet = f"{i}." if ordered else "&bull;"
        if primary:
            flows.append(
                Paragraph(
                    f'<font color="#C8102E">{bullet}</font> &nbsp; {primary}',
                    styles["li"],
                )
            )
        for n in nested:
            sub = block_list(n, styles, ordered=(n.name == "ol"))
            for f in sub:
                # indent further by overriding style on the fly via wrapping
                flows.append(f)
    return flows


def block_code(pre, styles):
    raw = pre.get_text()
    raw = sanitise_text(raw).rstrip()
    if not raw:
        return None
    # Preserve indentation, escape XML, swap spaces to nbsp for layout
    lines = [escape_xml(ln) for ln in raw.split("\n")]
    body = "<br/>".join(
        ln.replace("  ", "&nbsp;&nbsp;") for ln in lines
    )
    return Paragraph(body, styles["code"])


def block_blockquote(bq, styles):
    parts = []
    for c in bq.children:
        if isinstance(c, NavigableString):
            parts.append(escape_xml(sanitise_text(str(c))))
        else:
            parts.append("".join(inline_to_rl(cc) for cc in c.children))
    text = " ".join(p.strip() for p in parts if p.strip())
    if not text:
        return None
    return Paragraph(text, styles["quote"])


def block_hr(styles):
    return HRFlowable(
        width="100%",
        thickness=0.5,
        color=SOFT_GRAY,
        spaceBefore=6,
        spaceAfter=8,
    )


def block_table(tbl, styles, doc_width):
    """Convert a markdown table to a reportlab Table with column-fitting."""

    head_cells = []
    body_rows = []

    thead = tbl.find("thead")
    if thead:
        for tr in thead.find_all("tr"):
            head_cells = [
                "".join(inline_to_rl(c) for c in th.children).strip()
                for th in tr.find_all(["th", "td"])
            ]

    tbody = tbl.find("tbody") or tbl
    for tr in tbody.find_all("tr"):
        row = [
            "".join(inline_to_rl(c) for c in td.children).strip()
            for td in tr.find_all(["td", "th"])
        ]
        if row and row != head_cells:
            body_rows.append(row)

    if not head_cells and not body_rows:
        return None

    # Normalize column count
    n_cols = max(
        len(head_cells) if head_cells else 0,
        max((len(r) for r in body_rows), default=0),
    )
    if not n_cols:
        return None

    def pad(row):
        return row + [""] * (n_cols - len(row))

    head_cells = pad(head_cells)
    body_rows = [pad(r) for r in body_rows]

    # Wrap cells in Paragraphs for wrapping
    def wrap_cell(text, header=False):
        style = styles["body_small"] if not header else ParagraphStyle(
            "TblHdr",
            parent=styles["body_small"],
            fontName="Helvetica-Bold",
            textColor=colors.white,
        )
        return Paragraph(text or "&nbsp;", style)

    data = []
    if head_cells:
        data.append([wrap_cell(c, header=True) for c in head_cells])
    for r in body_rows:
        data.append([wrap_cell(c) for c in r])

    # Even column widths
    col_w = doc_width / n_cols
    tbl_f = Table(data, colWidths=[col_w] * n_cols, repeatRows=1 if head_cells else 0)
    style = TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), BVC_RED),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, -1), 9),
        ("ALIGN",        (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",   (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ("LEFTPADDING",  (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ROW_ALT]),
        ("LINEBELOW",    (0, 0), (-1, 0), 0.5, BVC_RED_DARK),
        ("BOX",          (0, 0), (-1, -1), 0.4, SOFT_GRAY),
        ("INNERGRID",    (0, 0), (-1, -1), 0.25, SOFT_GRAY),
    ])
    tbl_f.setStyle(style)
    return tbl_f


# ---------------------------------------------------------------------
# MD → FLOWABLES
# ---------------------------------------------------------------------
def md_to_flowables(md_text: str, styles, doc_width):
    html = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "sane_lists"],
    )
    soup = BeautifulSoup(html, "html.parser")

    flow = []

    for el in soup.children:
        if isinstance(el, NavigableString):
            continue

        name = el.name

        if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            lvl = int(name[1])
            f = block_heading(el, lvl, styles)
            if f:
                flow.append(f)

        elif name == "p":
            f = block_paragraph(el, styles)
            if f:
                flow.append(f)

        elif name == "pre":
            code_el = el.find("code") or el
            f = block_code(code_el, styles)
            if f:
                flow.append(f)
                flow.append(Spacer(1, 2))

        elif name == "ul":
            flow.extend(block_list(el, styles, ordered=False))
            flow.append(Spacer(1, 3))

        elif name == "ol":
            flow.extend(block_list(el, styles, ordered=True))
            flow.append(Spacer(1, 3))

        elif name == "blockquote":
            f = block_blockquote(el, styles)
            if f:
                flow.append(f)

        elif name == "hr":
            flow.append(block_hr(styles))

        elif name == "table":
            f = block_table(el, styles, doc_width)
            if f:
                flow.append(f)
                flow.append(Spacer(1, 6))

    return flow


# ---------------------------------------------------------------------
# COVER + HEADER/FOOTER
# ---------------------------------------------------------------------
def draw_cover(canv, doc, styles, title, subtitle, version, doc_date):
    canv.saveState()
    w, h = A4

    # Top BVC red panel
    canv.setFillColor(BVC_RED)
    canv.rect(0, h - 11 * cm, w, 11 * cm, stroke=0, fill=1)

    # Dark band
    canv.setFillColor(BVC_RED_DARK)
    canv.rect(0, h - 11.4 * cm, w, 0.4 * cm, stroke=0, fill=1)

    # Logo block (text-based — no external image dep)
    canv.setFillColor(colors.white)
    canv.setFont("Helvetica-Bold", 12)
    canv.drawString(2.2 * cm, h - 2.4 * cm, "BVC24 ERP")
    canv.setFont("Helvetica", 9)
    canv.drawString(2.2 * cm, h - 2.9 * cm, "AI SMART MANUFACTURING")

    # Title
    canv.setFont("Helvetica-Bold", 32)
    canv.drawString(2.2 * cm, h - 6.0 * cm, "Employee Module")
    canv.setFont("Helvetica-Bold", 32)
    canv.drawString(2.2 * cm, h - 7.4 * cm, "Documentation")

    # Subtitle
    canv.setFont("Helvetica", 13)
    canv.drawString(2.2 * cm, h - 9.0 * cm, "Deployment & User Guide")

    # Bottom meta block
    canv.setFillColor(INK)
    canv.setFont("Helvetica-Bold", 11)
    canv.drawString(2.2 * cm, 5.4 * cm, "Bharath Vending Corporation")

    canv.setFillColor(SLATE)
    canv.setFont("Helvetica", 10)
    canv.drawString(2.2 * cm, 4.7 * cm, "Vendor-based Manufacturing ERP")

    canv.setFillColor(MUTED)
    canv.setFont("Helvetica", 9)
    canv.drawString(2.2 * cm, 3.2 * cm, f"Version: {version}")
    canv.drawString(2.2 * cm, 2.7 * cm, f"Date:    {doc_date}")
    canv.drawString(2.2 * cm, 2.2 * cm, "Audience: HR | IT | Employees | Implementers")

    # Page footer hairline
    canv.setStrokeColor(BVC_RED)
    canv.setLineWidth(1.2)
    canv.line(2.2 * cm, 1.6 * cm, w - 2.2 * cm, 1.6 * cm)

    canv.setFillColor(MUTED)
    canv.setFont("Helvetica", 8)
    canv.drawString(2.2 * cm, 1.1 * cm, "Confidential - internal use only")
    canv.drawRightString(w - 2.2 * cm, 1.1 * cm, "BVC24 Platform")

    canv.restoreState()


def draw_page_chrome(canv, doc, title):
    """Header + footer on every non-cover page."""
    canv.saveState()
    w, h = A4

    # Top header strip
    canv.setFillColor(BVC_RED)
    canv.rect(0, h - 1.4 * cm, w, 1.4 * cm, stroke=0, fill=1)
    canv.setFillColor(colors.white)
    canv.setFont("Helvetica-Bold", 10)
    canv.drawString(2 * cm, h - 0.9 * cm, "BVC24 ERP - Employee Module")
    canv.setFont("Helvetica", 9)
    canv.drawRightString(w - 2 * cm, h - 0.9 * cm, title)

    # Footer hairline + page number
    canv.setStrokeColor(SOFT_GRAY)
    canv.setLineWidth(0.4)
    canv.line(2 * cm, 1.4 * cm, w - 2 * cm, 1.4 * cm)
    canv.setFillColor(MUTED)
    canv.setFont("Helvetica", 8)
    canv.drawString(2 * cm, 0.9 * cm, "Bharath Vending Corporation")
    canv.drawRightString(w - 2 * cm, 0.9 * cm, f"Page {doc.page}")

    canv.restoreState()


# ---------------------------------------------------------------------
# DOC BUILD
# ---------------------------------------------------------------------
def build_pdf(md_path: Path, out_path: Path):
    md_text = md_path.read_text(encoding="utf-8")

    styles = build_styles()

    # Margins: leave space for header (top) + footer
    left = right = 2 * cm
    top = 2.0 * cm
    bottom = 1.8 * cm
    page_w, page_h = A4
    frame_w = page_w - left - right

    # Two page templates: cover (no header), content (header + footer)
    cover_frame = Frame(0, 0, page_w, page_h, id="cover")
    content_frame = Frame(
        left, bottom, frame_w, page_h - top - bottom, id="content"
    )

    def cover_on_page(c, d):
        draw_cover(c, d, styles, "Employee Module Documentation",
                   "Deployment & User Guide", "1.0", "6 June 2026")

    def content_on_page(c, d):
        draw_page_chrome(c, d, "Deployment & User Guide")

    doc = BaseDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=left, rightMargin=right,
        topMargin=top, bottomMargin=bottom,
        title="BVC24 - Employee Module Documentation",
        author="BVC24 Platform Team",
        subject="Employee Module Deployment & User Guide",
    )
    doc.addPageTemplates([
        PageTemplate(id="Cover",   frames=[cover_frame],   onPage=cover_on_page),
        PageTemplate(id="Content", frames=[content_frame], onPage=content_on_page),
    ])

    story = []

    # COVER page is index 0 (starts on the Cover template). Schedule the
    # content template to apply to the NEXT page BEFORE we break, otherwise
    # the cover artwork bleeds onto page 2.
    story.append(Spacer(1, 1))
    story.append(_NextPageTemplate("Content"))
    story.append(PageBreak())

    # Convert markdown
    flowables = md_to_flowables(md_text, styles, frame_w)
    story.extend(flowables)

    doc.build(story)


# Helper: switch template on the fly
from reportlab.platypus.doctemplate import NextPageTemplate as _NextPageTemplate


# ---------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------
if __name__ == "__main__":

    repo_root = Path(__file__).resolve().parents[2]
    md_file = repo_root / "docs" / "EMPLOYEE_MODULE.md"
    pdf_file = repo_root / "docs" / "EMPLOYEE_MODULE.pdf"

    print(f"Reading:  {md_file}")
    print(f"Writing:  {pdf_file}")

    build_pdf(md_file, pdf_file)

    size_kb = pdf_file.stat().st_size / 1024
    print(f"Done. {size_kb:.1f} KB.")
