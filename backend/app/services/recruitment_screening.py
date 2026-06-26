"""
Recruitment screening + ranking + offer-letter helpers.

Pure functions on top of the SQLAlchemy models. Used by the
/recruitment routes; no FastAPI dependency in this file so the
business logic is testable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import List, Optional, Dict, Any, Tuple
import os
import json
import re

from sqlalchemy.orm import Session


# =====================================================================
# Skill-match scoring
# =====================================================================

def _tokenise_skills(s: Optional[str]) -> List[str]:
    if not s:
        return []
    raw = re.split(r"[,;|/\n]+", s)
    return sorted({x.strip().lower() for x in raw if x and x.strip()})


def screen_application(
    candidate_skills: Optional[str],
    candidate_total_exp_years: Optional[float],
    candidate_highest_qual: Optional[str],
    job_required_skills: Optional[str],
    job_preferred_skills: Optional[str],
    job_exp_min: Optional[float],
    job_exp_max: Optional[float],
    job_required_education: Optional[str],
) -> Dict[str, Any]:
    """Compute the screening score for one candidate against one job.

    Returns a dict ready to write back to CandidateApplication."""

    cand_skills = set(_tokenise_skills(candidate_skills))
    req_skills  = set(_tokenise_skills(job_required_skills))
    pref_skills = set(_tokenise_skills(job_preferred_skills))

    # ---- Skill match ----
    matched_req  = cand_skills & req_skills
    missing_req  = req_skills - cand_skills
    matched_pref = cand_skills & pref_skills

    if req_skills:
        # Required skills weighted 80%, preferred 20%.
        skill_pct = (
            (len(matched_req) / len(req_skills)) * 80.0
            + (len(matched_pref) / max(len(pref_skills), 1)) * 20.0
        )
    elif pref_skills:
        skill_pct = (len(matched_pref) / len(pref_skills)) * 100.0
    else:
        skill_pct = 100.0   # no skill requirements => everyone passes the skill axis

    # ---- Experience match ----
    exp = float(candidate_total_exp_years or 0)
    mn  = float(job_exp_min or 0)
    mx  = job_exp_max if job_exp_max is not None else None

    if mn == 0 and mx is None:
        exp_pct = 100.0
    elif exp < mn:
        # below minimum — proportional partial credit
        exp_pct = max(0.0, (exp / mn) * 70.0) if mn > 0 else 70.0
    elif mx is not None and exp > mx:
        # over-qualified — gentle penalty (we still want senior candidates)
        gap = exp - mx
        exp_pct = max(60.0, 100.0 - gap * 5)
    else:
        exp_pct = 100.0

    # ---- Education match ----
    edu_pct = _education_match(candidate_highest_qual, job_required_education)

    # ---- Overall (weighted) ----
    overall = round(0.5 * skill_pct + 0.3 * exp_pct + 0.2 * edu_pct, 2)

    if   overall >= 80: status = "HIGHLY_SUITABLE"
    elif overall >= 60: status = "SUITABLE"
    elif overall >= 40: status = "PARTIALLY_SUITABLE"
    else:               status = "NOT_SUITABLE"

    matched_skills_str = ", ".join(sorted(matched_req | matched_pref))
    missing_skills_str = ", ".join(sorted(missing_req))

    summary = _narrative(
        overall=overall, skill_pct=skill_pct,
        exp_pct=exp_pct, edu_pct=edu_pct,
        matched=matched_skills_str, missing=missing_skills_str,
        exp_years=exp, exp_min=mn, exp_max=mx,
        qualification=candidate_highest_qual,
        required_education=job_required_education,
    )

    return {
        "SKILL_MATCH_PCT":      round(skill_pct, 2),
        "EXPERIENCE_MATCH_PCT": round(exp_pct, 2),
        "EDUCATION_MATCH_PCT":  round(edu_pct, 2),
        "OVERALL_SCORE":        overall,
        "MATCHING_SKILLS":      matched_skills_str,
        "MISSING_SKILLS":       missing_skills_str,
        "SCREENING_STATUS":     status,
        "SCREENING_SUMMARY":    summary,
        "SCREENED_AT":          datetime.utcnow(),
    }


_DEGREE_RANK = {
    "phd": 8, "ph.d": 8, "doctor": 8,
    "m.tech": 7, "mtech": 7, "m.e.": 7, "me": 7,
    "ms": 6, "m.sc": 6, "msc": 6, "mba": 6, "mca": 6,
    "b.tech": 5, "btech": 5, "b.e.": 5, "be": 5,
    "bsc": 4, "b.sc": 4, "bca": 4, "bcom": 4, "ba": 4,
    "diploma": 3, "polytechnic": 3,
    "iti": 2,
    "12th": 1, "hsc": 1, "10th": 1, "sslc": 1,
}


def _rank_qualification(text: Optional[str]) -> int:
    if not text:
        return 0
    t = text.lower()
    best = 0
    for key, rank in _DEGREE_RANK.items():
        if key in t and rank > best:
            best = rank
    return best


def _education_match(candidate_qual: Optional[str], job_qual: Optional[str]) -> float:
    if not job_qual:
        return 100.0
    cand_rank = _rank_qualification(candidate_qual)
    job_rank  = _rank_qualification(job_qual)
    if cand_rank == 0:
        return 50.0   # we couldn't parse; don't penalise too hard
    if cand_rank >= job_rank:
        return 100.0
    diff = job_rank - cand_rank
    return max(0.0, 100.0 - diff * 25.0)


# =====================================================================
# Narrative builder (deterministic; Gemini can replace this output)
# =====================================================================

def _narrative(*, overall: float, skill_pct: float, exp_pct: float,
              edu_pct: float, matched: str, missing: str,
              exp_years: float, exp_min: float, exp_max: Optional[float],
              qualification: Optional[str],
              required_education: Optional[str]) -> str:

    lines: List[str] = []

    # Headline
    headline = (
        "Highly suitable candidate." if overall >= 80 else
        "Suitable candidate."        if overall >= 60 else
        "Partially suitable — gaps on critical requirements." if overall >= 40 else
        "Not a strong fit for this role."
    )
    lines.append(headline)

    if matched:
        lines.append(f"Matched skills: {matched}.")
    if missing:
        lines.append(f"Missing required skills: {missing}.")

    if exp_min or exp_max:
        if exp_years < exp_min:
            lines.append(
                f"Experience: {exp_years} year(s) vs requirement of "
                f"{exp_min}+ year(s) — below minimum."
            )
        elif exp_max is not None and exp_years > exp_max:
            lines.append(
                f"Experience: {exp_years} year(s) vs range "
                f"{exp_min}-{exp_max} — over-qualified, may seek higher comp."
            )
        else:
            lines.append(
                f"Experience: {exp_years} year(s) — within the required range."
            )

    if required_education:
        if edu_pct >= 100:
            lines.append("Education meets the requirement.")
        elif edu_pct >= 50:
            lines.append(
                f"Education partially meets the requirement "
                f"(requirement: {required_education}; candidate: {qualification or 'unspecified'})."
            )
        else:
            lines.append(
                f"Education below requirement (need {required_education}; "
                f"candidate: {qualification or 'unspecified'})."
            )

    return " ".join(lines)


# =====================================================================
# Ranking — combine multiple application records for one job
# =====================================================================

def rank_candidates(
    applications: List[Dict[str, Any]],
    weights: Optional[Dict[str, float]] = None,
) -> List[Dict[str, Any]]:
    """Given a list of application dicts (already screened), produce a
    ranked list of dicts (highest-suitability first), each enriched
    with a `rank` field. Caller may pass custom weights:

        weights = {
            "skill":      0.4,
            "experience": 0.3,
            "education":  0.1,
            "interview":  0.2,
        }
    """
    w = weights or {
        "skill":      0.5,
        "experience": 0.25,
        "education":  0.15,
        "interview":  0.10,
    }
    s_total = sum(w.values()) or 1.0
    # Normalise
    w = {k: v / s_total for k, v in w.items()}

    out: List[Dict[str, Any]] = []
    for a in applications:
        skill = float(a.get("SKILL_MATCH_PCT")      or 0)
        exp   = float(a.get("EXPERIENCE_MATCH_PCT") or 0)
        edu   = float(a.get("EDUCATION_MATCH_PCT")  or 0)
        ivw   = float(a.get("INTERVIEW_SCORE")      or 0) * 10  # 0-10 -> 0-100
        weighted = (
            w["skill"] * skill
            + w["experience"] * exp
            + w["education"] * edu
            + w["interview"] * ivw
        )
        x = dict(a)
        x["WEIGHTED_SCORE"] = round(weighted, 2)
        out.append(x)

    out.sort(key=lambda x: x["WEIGHTED_SCORE"], reverse=True)
    for i, row in enumerate(out, start=1):
        row["RANK"] = i
    return out


# =====================================================================
# Interview question suggestions
# =====================================================================

_BUCKET_QUESTIONS = {
    "python": [
        "What's the difference between a list and a tuple in Python?",
        "How would you handle a memory-intensive data processing job in Python?",
        "Walk me through Python's GIL and when it matters in practice.",
    ],
    "fastapi": [
        "How does FastAPI dependency injection differ from Flask's blueprints?",
        "How would you secure a FastAPI endpoint with role-based access?",
        "Explain how you'd test a FastAPI app end-to-end.",
    ],
    "react": [
        "Explain the difference between useEffect and useLayoutEffect.",
        "When would you reach for useMemo vs useCallback?",
        "How do you handle global state in a large React app?",
    ],
    "mysql": [
        "What's the difference between INNER JOIN and LEFT JOIN?",
        "How would you optimize a slow query in MySQL?",
        "Explain transaction isolation levels.",
    ],
    "leadership": [
        "Tell me about a difficult decision you made as a team lead.",
        "How do you handle underperforming team members?",
        "Describe a time you had to deliver a project under tight deadlines.",
    ],
    "mechanical design": [
        "Walk me through a recent design you've done in SolidWorks.",
        "How do you approach DFM (design for manufacturability)?",
        "Tell me about a tolerance stack-up problem you've solved.",
    ],
    "general": [
        "Tell me about yourself and your most recent role.",
        "Why are you interested in this role?",
        "What's a project you're most proud of and why?",
        "Describe a time you disagreed with a team member — how did you resolve it?",
        "Where do you see yourself in three years?",
    ],
}


def suggest_interview_questions(
    candidate_skills: Optional[str],
    job_required_skills: Optional[str],
    round_type: Optional[str] = None,
    limit: int = 8,
) -> List[str]:
    """Pick interview questions based on the intersection of candidate
    skills and job requirements, plus generic questions per round."""
    cand = set(_tokenise_skills(candidate_skills))
    req  = set(_tokenise_skills(job_required_skills))
    relevant = cand & req

    picks: List[str] = []
    seen = set()

    def add(qs: List[str]):
        for q in qs:
            if q in seen: continue
            picks.append(q); seen.add(q)

    # Skill-driven first
    for s in sorted(relevant, key=lambda x: -len(x)):
        if s in _BUCKET_QUESTIONS:
            add(_BUCKET_QUESTIONS[s])
        if len(picks) >= limit:
            break

    # Round-specific add-ons
    if round_type == "HR":
        add([
            "Walk me through your CV.",
            "What are your salary expectations?",
            "When can you join?",
        ])
    elif round_type == "MANAGERIAL":
        add(_BUCKET_QUESTIONS["leadership"])

    # Fill from general bucket
    add(_BUCKET_QUESTIONS["general"])

    return picks[:limit]


# =====================================================================
# Auto-generate codes
# =====================================================================

def next_code(prefix: str, db: Session, model, code_field: str) -> str:
    """Generate something like JOB-2026-0001 by counting existing rows
    for the current year."""
    year = datetime.utcnow().year
    count = db.query(model).filter(
        getattr(model, code_field).like(f"{prefix}-{year}-%")
    ).count()
    return f"{prefix}-{year}-{count + 1:04d}"


# =====================================================================
# Offer-letter rendering
# =====================================================================

def _inr(n) -> str:
    try:
        return f"{float(n):,.2f}"
    except Exception:
        return str(n)


def render_offer_pdf(
    *,
    offer_number: str,
    candidate_name: str,
    candidate_email: Optional[str],
    job_title: str,
    department: Optional[str],
    ctc: float,
    breakdown: Optional[Dict[str, float]],
    benefits: Optional[str],
    joining_date: Optional[date],
    probation_months: int,
    notice_period_days: int,
    employment_terms: Optional[str],
    special_clauses: Optional[str],
    company: Dict[str, Any],
) -> bytes:
    """Render a fully-branded offer letter PDF using reportlab.

    `company` is a dict with the company master fields:
        name, legal_name, tagline, address_line_1, address_line_2,
        city, state, pincode, country, gst_number, pan_number,
        phone, email, website, logo_path (absolute disk path)

    Falls back to a simple text-PDF if reportlab isn't installed.
    """
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
        import os as _os
    except Exception:
        return f"OFFER LETTER\n{offer_number}\n".encode("utf-8")

    # --- Brand palette (from BVC24 logo) ---
    BVC_RED  = colors.HexColor("#C8102E")
    BVC_DARK = colors.HexColor("#7A1022")
    GREY     = colors.HexColor("#475569")
    LIGHT    = colors.HexColor("#f1f5f9")
    GOLD     = colors.HexColor("#F4B324")

    import io as _io
    buf = _io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=18 * mm,
        title=f"Offer Letter {offer_number}",
    )

    # ----------------- Styles -----------------
    base = getSampleStyleSheet()
    s_company = ParagraphStyle(
        "company", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=14, leading=16,
        textColor=BVC_DARK, spaceAfter=0,
    )
    s_company_sub = ParagraphStyle(
        "companySub", parent=base["Normal"],
        fontName="Helvetica", fontSize=8.5, leading=11,
        textColor=GREY,
    )
    s_title = ParagraphStyle(
        "title", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=15, leading=20,
        alignment=TA_CENTER, textColor=BVC_DARK,
        spaceBefore=8, spaceAfter=4,
    )
    s_offer_num = ParagraphStyle(
        "offerNum", parent=base["Normal"],
        fontName="Helvetica", fontSize=10, leading=12,
        alignment=TA_CENTER, textColor=GREY,
        spaceAfter=10,
    )
    s_label = ParagraphStyle(
        "label", parent=base["Normal"],
        fontName="Helvetica-Bold", fontSize=10, leading=12,
        textColor=BVC_DARK, spaceBefore=10, spaceAfter=4,
    )
    s_body = ParagraphStyle(
        "body", parent=base["Normal"],
        fontName="Helvetica", fontSize=10.5, leading=14.5,
        textColor=colors.HexColor("#1a1a1a"),
    )
    s_small = ParagraphStyle(
        "small", parent=base["Normal"],
        fontName="Helvetica", fontSize=9, leading=11.5,
        textColor=GREY,
    )

    story = []

    # ============================================================
    # LETTERHEAD
    # ============================================================
    logo_path = (company or {}).get("logo_path")
    logo_cell = ""
    if logo_path and _os.path.exists(logo_path):
        try:
            img = RLImage(logo_path, width=28 * mm, height=28 * mm)
            img.hAlign = "LEFT"
            logo_cell = img
        except Exception:
            logo_cell = ""

    legal_name = company.get("legal_name") or company.get("name") or "Bharath Vending Corporation"
    tagline    = company.get("tagline")    or ""
    addr_lines = []
    a1 = company.get("address_line_1")
    a2 = company.get("address_line_2")
    if a1: addr_lines.append(a1)
    if a2: addr_lines.append(a2)
    city_line = ", ".join(filter(None, [
        company.get("city"), company.get("state"),
        company.get("pincode"),
    ]))
    if city_line: addr_lines.append(city_line)
    if company.get("country"): addr_lines.append(company["country"])

    contact_bits = []
    if company.get("phone"):   contact_bits.append(company["phone"])
    if company.get("email"):   contact_bits.append(company["email"])
    if company.get("website"): contact_bits.append(company["website"])
    if contact_bits:
        addr_lines.append(" &nbsp;·&nbsp; ".join(contact_bits))

    statutory_bits = []
    if company.get("gst_number"): statutory_bits.append(f"GSTIN: {company['gst_number']}")
    if company.get("pan_number"): statutory_bits.append(f"PAN: {company['pan_number']}")

    right_lines = [Paragraph(legal_name, s_company)]
    if tagline:
        right_lines.append(Paragraph(tagline, s_company_sub))
    for ln in addr_lines:
        right_lines.append(Paragraph(ln, s_company_sub))
    if statutory_bits:
        right_lines.append(Spacer(1, 2))
        right_lines.append(Paragraph(
            " &nbsp;·&nbsp; ".join(statutory_bits), s_company_sub,
        ))

    header_table = Table(
        [[logo_cell, right_lines]],
        colWidths=[34 * mm, 130 * mm],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=2, color=BVC_RED,
                           spaceBefore=4, spaceAfter=6))
    # Gold accent line
    story.append(HRFlowable(width="100%", thickness=1, color=GOLD,
                           spaceBefore=0, spaceAfter=10))

    # ============================================================
    # TITLE
    # ============================================================
    story.append(Paragraph("OFFER OF EMPLOYMENT", s_title))
    story.append(Paragraph(
        f"Reference: <b>{offer_number}</b> &nbsp;·&nbsp; "
        f"Date: {datetime.utcnow().strftime('%d %B %Y')}",
        s_offer_num,
    ))

    # ============================================================
    # SALUTATION
    # ============================================================
    story.append(Paragraph(f"Dear <b>{candidate_name}</b>,", s_body))
    story.append(Spacer(1, 6))

    intro = (
        f"We are delighted to extend an offer of employment to you as "
        f"<b>{job_title}</b>"
        + (f" in our <b>{department}</b> department" if department else "")
        + f" at <b>{legal_name}</b>. Your appointment is subject to "
        f"the terms set out below."
    )
    story.append(Paragraph(intro, s_body))

    # ============================================================
    # POSITION DETAILS TABLE
    # ============================================================
    story.append(Paragraph("Position Details", s_label))

    joining_str = joining_date.strftime("%d %B %Y") if joining_date else "to be confirmed"

    pos_rows = [
        ["Position",          job_title],
        ["Department",        department or "—"],
        ["Joining Date",      joining_str],
        ["Probation Period",  f"{probation_months} months"],
        ["Notice Period",     f"{notice_period_days} days"],
        ["Reporting Location", company.get("city") or "Head Office"],
    ]
    pos_table = Table(pos_rows, colWidths=[55 * mm, 110 * mm])
    pos_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), BVC_DARK),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#1a1a1a")),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(pos_table)

    # ============================================================
    # COMPENSATION TABLE
    # ============================================================
    story.append(Paragraph("Annual Compensation", s_label))

    comp_rows = [["Component", "Amount (INR per annum)"]]
    if breakdown:
        for k, v in breakdown.items():
            comp_rows.append([k.replace("_", " ").title(), _inr(v)])
    # If no breakdown, just show total CTC as a single row
    comp_rows.append(["Total CTC", _inr(ctc)])

    comp_table = Table(comp_rows, colWidths=[110 * mm, 55 * mm])
    last_row_idx = len(comp_rows) - 1
    comp_table.setStyle(TableStyle([
        # Header row
        ("BACKGROUND", (0, 0), (-1, 0), BVC_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        # Total row
        ("BACKGROUND", (0, last_row_idx), (-1, last_row_idx), LIGHT),
        ("FONTNAME", (0, last_row_idx), (-1, last_row_idx), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, last_row_idx), (-1, last_row_idx), BVC_DARK),
        # Grid
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(comp_table)

    # ============================================================
    # BENEFITS
    # ============================================================
    if benefits:
        story.append(Paragraph("Benefits", s_label))
        # If user passed a comma-separated list, render as bullets
        bullets = [b.strip().rstrip(".") for b in benefits.split(",") if b.strip()]
        if len(bullets) >= 2:
            for b in bullets:
                story.append(Paragraph(f"&nbsp;&nbsp;•&nbsp; {b}", s_body))
        else:
            story.append(Paragraph(benefits, s_body))

    # ============================================================
    # EMPLOYMENT TERMS
    # ============================================================
    if employment_terms:
        story.append(Paragraph("Employment Terms", s_label))
        story.append(Paragraph(
            employment_terms.replace("\n", "<br/>"), s_body,
        ))

    # ============================================================
    # SPECIAL CLAUSES
    # ============================================================
    if special_clauses:
        story.append(Paragraph("Special Clauses", s_label))
        story.append(Paragraph(
            special_clauses.replace("\n", "<br/>"), s_body,
        ))

    # ============================================================
    # ACCEPTANCE
    # ============================================================
    story.append(Paragraph("Acceptance", s_label))
    story.append(Paragraph(
        "This offer remains valid for <b>7 days</b> from the date of issue. "
        "Please sign and return a copy of this letter to indicate your "
        "acceptance of the terms set out above.",
        s_body,
    ))

    story.append(Spacer(1, 18))

    # ============================================================
    # SIGNATURE BLOCK (two columns)
    # ============================================================
    sig_table = Table(
        [
            [
                Paragraph(f"For <b>{legal_name}</b>", s_body),
                Paragraph("Accepted by the candidate", s_body),
            ],
            [Spacer(1, 36), Spacer(1, 36)],
            [
                Paragraph("____________________________<br/>"
                         "<font size=9 color='#475569'>Authorised Signatory</font><br/>"
                         "<font size=9 color='#475569'>Human Resources</font>",
                         s_body),
                Paragraph(f"____________________________<br/>"
                         f"<font size=9 color='#475569'>{candidate_name}</font><br/>"
                         f"<font size=9 color='#475569'>Date: ____________________</font>",
                         s_body),
            ],
        ],
        colWidths=[82 * mm, 82 * mm],
    )
    sig_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(KeepTogether(sig_table))

    # ============================================================
    # FOOTER
    # ============================================================
    story.append(Spacer(1, 18))
    story.append(HRFlowable(width="100%", thickness=0.5,
                           color=colors.HexColor("#cbd5e1"),
                           spaceBefore=4, spaceAfter=4))
    footer = (
        f"This is a system-generated offer letter from {legal_name}. "
        f"Reference: <b>{offer_number}</b>. "
        f"For any clarifications please contact "
        f"<b>{company.get('email') or 'HR'}</b>."
    )
    story.append(Paragraph(footer, s_small))

    doc.build(story)
    return buf.getvalue()


# Kept for backward compatibility — some callers may still pass a
# pre-rendered text string. New callers should pass structured kwargs.
def render_offer_text(**kwargs) -> str:  # pragma: no cover
    """Deprecated. Kept so older callers don't break. Use render_offer_pdf
    with structured kwargs directly — text rendering is no longer the
    canonical format."""
    return ""
