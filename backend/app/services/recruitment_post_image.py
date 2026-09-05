"""Job-post image generator for the voice-agent flow.

Renders a 1080 × 1350 (Instagram / LinkedIn portrait) PNG poster
from a requisition draft. Design brief:

  - BVC24 brand red top rail with "WE'RE HIRING"
  - Big role title, department + location line
  - Three stat blocks: Openings · Experience · Type
  - Skills chips (up to 8)
  - Required education
  - Contact strip at the bottom with company name + email

No external services, no image APIs — one Pillow render, ~250 ms
on the on-prem box. Fonts fall back to Pillow's default bitmap
face when no TTF is available so the endpoint never fails on a
fresh dev machine.
"""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------------
# Design tokens
# ---------------------------------------------------------------------

W, H = 1080, 1600                       # portrait — 4:6, taller to fit CTC + preferred skills + apply-by
BRAND       = (200, 16, 46)             # BVC24 red
BRAND_DARK  = (122, 16, 34)
GOLD        = (244, 179, 36)
INK         = (14, 20, 28)
MUTED       = (100, 108, 115)
RULE        = (223, 225, 228)
GROUND      = (250, 247, 242)           # warm off-white
CHIP_BG     = (252, 240, 232)
CHIP_BORDER = (232, 190, 168)


# Fallback font search — check the usual system paths on Windows +
# Linux. If nothing is found we use Pillow's built-in bitmap font,
# which still renders but with less polish.
def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        # Windows
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        # Linux (matches what the deploy box will have)
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
            else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold
            else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        try:
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str,
          font: ImageFont.FreeTypeFont, max_width: int) -> List[str]:
    """Naive word-wrap using text bounding boxes."""
    if not text:
        return []
    lines: List[str] = []
    words = text.split()
    line = ""
    for w in words:
        candidate = f"{line} {w}".strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_width:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def _round_rect(draw: ImageDraw.ImageDraw, xy, radius, fill=None,
                outline=None, width=1) -> None:
    """Pillow's built-in rounded_rectangle wrapper — some older
    Pillow versions don't support it."""
    try:
        draw.rounded_rectangle(xy, radius=radius, fill=fill,
                               outline=outline, width=width)
    except AttributeError:
        # Fallback: plain rect
        draw.rectangle(xy, fill=fill, outline=outline, width=width)


def _fmt_inr(n: Optional[float]) -> Optional[str]:
    """1,20,000 style Indian-numeral formatting for a rupee amount."""
    if n is None:
        return None
    try:
        n = int(round(float(n)))
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    s = str(n)
    # Indian grouping: last 3 digits, then every 2
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head_grouped = ""
        while len(head) > 2:
            head_grouped = "," + head[-2:] + head_grouped
            head = head[:-2]
        head_grouped = head + head_grouped
        s = f"{head_grouped},{tail}"
    return f"₹{s}"


def _fmt_date_human(iso: Optional[str]) -> Optional[str]:
    """'2026-09-30' → '30 September 2026'. Best-effort; returns
    the input as-is if it's not YYYY-MM-DD."""
    if not iso:
        return None
    try:
        from datetime import datetime
        d = datetime.strptime(iso.strip()[:10], "%Y-%m-%d")
        return d.strftime("%d %B %Y").lstrip("0")
    except Exception:
        return iso


# ---------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------

def render_job_post(draft: Dict[str, Any],
                    company: Optional[Dict[str, Any]] = None) -> bytes:
    """Return raw PNG bytes of the branded 1080 × 1350 poster.

    `draft` shape (all fields optional except POSITION_TITLE):
      POSITION_TITLE, DEPARTMENT, LOCATION, HEADCOUNT,
      EXPERIENCE_MIN_YEARS, EXPERIENCE_MAX_YEARS,
      REQUIRED_EDUCATION, REQUIRED_SKILLS, EMPLOYMENT_TYPE,
      URGENCY, JUSTIFICATION

    `company` shape (optional):
      { name, tagline, careers_email, address, phone, website }
    """
    company = company or {
        "name":           "Bharath Vending Corporation",
        "tagline":        "Manufacturing Management System",
        "careers_email":  "careers@bvc24.com",
        "address":        "Plot No: 16B, E&E Industrial Estate, "
                          "Civil Aerodrome Post, Sitra, "
                          "Coimbatore – 641 014, Tamil Nadu",
        "phone":          "+91 90000 12345",
        "website":        "www.bvc24.in",
    }

    im = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(im)

    # -----------------------------------------------------------
    # 1) Top brand rail — solid red bar with corner accent
    # -----------------------------------------------------------
    rail_h = 120
    d.rectangle([0, 0, W, rail_h], fill=BRAND)
    # Gold corner accent
    d.polygon([(0, rail_h), (140, rail_h), (0, rail_h + 60)], fill=GOLD)

    f_kicker = _load_font(24, bold=True)
    f_brand  = _load_font(38, bold=True)
    d.text((60, 30), "BVC24 · CAREERS", font=f_kicker, fill=(255, 255, 255))
    d.text((60, 60), "WE'RE HIRING", font=f_brand, fill=(255, 255, 255))

    # Urgency pill on the right side of the rail
    urgency = (draft.get("URGENCY") or "").upper()
    if urgency in ("HIGH", "URGENT"):
        pill_label = "URGENT · APPLY NOW"
        pill_w = 380
    else:
        pill_label = "APPLY NOW"
        pill_w = 220
    pill_x = W - pill_w - 60
    f_pill = _load_font(20, bold=True)
    _round_rect(d,
        [pill_x, 46, pill_x + pill_w, 46 + 46],
        radius=23, fill=GOLD)
    _bbox = d.textbbox((0, 0), pill_label, font=f_pill)
    _tx = pill_x + (pill_w - (_bbox[2] - _bbox[0])) // 2
    d.text((_tx, 56), pill_label, font=f_pill, fill=BRAND_DARK)

    # -----------------------------------------------------------
    # 2) Role title block
    # -----------------------------------------------------------
    title = (draft.get("POSITION_TITLE") or "New Role").strip()
    dept  = (draft.get("DEPARTMENT")     or "").strip()
    loc   = (draft.get("LOCATION")       or "Coimbatore").strip()
    etype = (draft.get("EMPLOYMENT_TYPE") or "FULL_TIME").replace("_", " ").title()

    f_title    = _load_font(72, bold=True)
    f_subtitle = _load_font(28, bold=False)

    y = rail_h + 60
    title_lines = _wrap(d, title, f_title, W - 120)
    for line in title_lines[:2]:
        d.text((60, y), line, font=f_title, fill=INK)
        y += 82
    if len(title_lines) > 2:
        d.text((60, y), title_lines[2][:24] + "…", font=f_title, fill=INK)
        y += 82

    subtitle_bits = [b for b in [dept, loc, etype] if b]
    if subtitle_bits:
        subtitle_text = "  ·  ".join(subtitle_bits)
        d.text((60, y + 6), subtitle_text, font=f_subtitle, fill=MUTED)
        y += 46

    # -----------------------------------------------------------
    # 3) Three stat blocks — Openings · Experience · Type
    # -----------------------------------------------------------
    y_stats = y + 40
    stat_h  = 130
    stat_gap = 20
    stat_w  = (W - 120 - 2 * stat_gap) // 3

    exp_min = draft.get("EXPERIENCE_MIN_YEARS")
    exp_max = draft.get("EXPERIENCE_MAX_YEARS")
    if exp_min is not None or exp_max is not None:
        lo = f"{int(exp_min) if exp_min is not None else 0}"
        hi = f"{int(exp_max)}" if exp_max else "+"
        exp_val = f"{lo}–{hi}" if exp_max else f"{lo}{hi}"
        exp_label = "YEARS EXPERIENCE"
    else:
        exp_val = "Any"
        exp_label = "EXPERIENCE"

    stats = [
        (str(draft.get("HEADCOUNT") or 1), "OPENING" + ("S" if (draft.get("HEADCOUNT") or 1) > 1 else "")),
        (exp_val, exp_label),
        (etype.split()[0].upper(), "EMPLOYMENT"),
    ]

    f_stat_v = _load_font(56, bold=True)
    f_stat_l = _load_font(16, bold=True)
    for i, (val, label) in enumerate(stats):
        x = 60 + i * (stat_w + stat_gap)
        _round_rect(d,
            [x, y_stats, x + stat_w, y_stats + stat_h],
            radius=14,
            fill=(255, 255, 255),
            outline=RULE, width=1,
        )
        # value
        vb = d.textbbox((0, 0), val, font=f_stat_v)
        vx = x + (stat_w - (vb[2] - vb[0])) // 2
        d.text((vx, y_stats + 24), val, font=f_stat_v, fill=BRAND)
        # label
        lb = d.textbbox((0, 0), label, font=f_stat_l)
        lx = x + (stat_w - (lb[2] - lb[0])) // 2
        d.text((lx, y_stats + 92), label, font=f_stat_l, fill=MUTED)

    y_after_stats = y_stats + stat_h + 40

    # -----------------------------------------------------------
    # 4) Education line
    # -----------------------------------------------------------
    f_h3  = _load_font(20, bold=True)
    f_body = _load_font(26, bold=False)

    edu = (draft.get("REQUIRED_EDUCATION") or "").strip()
    if edu:
        d.text((60, y_after_stats), "QUALIFICATION",
               font=f_h3, fill=MUTED)
        d.text((60, y_after_stats + 30), edu, font=f_body, fill=INK)
        y_after_stats += 90

    # -----------------------------------------------------------
    # 5) Compensation
    # -----------------------------------------------------------
    ctc_min = _fmt_inr(draft.get("BUDGET_CTC_MIN"))
    ctc_max = _fmt_inr(draft.get("BUDGET_CTC_MAX"))
    if ctc_min or ctc_max:
        d.text((60, y_after_stats), "COMPENSATION",
               font=f_h3, fill=MUTED)
        if ctc_min and ctc_max:
            ctc_text = f"{ctc_min}  –  {ctc_max}  per annum"
        else:
            ctc_text = f"{ctc_min or ctc_max}  per annum"
        d.text((60, y_after_stats + 30), ctc_text, font=f_body, fill=INK)
        y_after_stats += 90

    # -----------------------------------------------------------
    # 6) Required skills chips
    # -----------------------------------------------------------
    skills_raw = (draft.get("REQUIRED_SKILLS") or "").strip()
    if skills_raw:
        skills = [s.strip() for s in skills_raw.split(",") if s.strip()][:8]
        if skills:
            d.text((60, y_after_stats), "REQUIRED SKILLS",
                   font=f_h3, fill=MUTED)
            y_after_stats += 34

            f_chip = _load_font(22, bold=True)
            cx, cy = 60, y_after_stats
            row_h = 52
            for s in skills:
                tw = d.textbbox((0, 0), s, font=f_chip)
                w = (tw[2] - tw[0]) + 32
                if cx + w > W - 60:
                    cx = 60
                    cy += row_h + 10
                _round_rect(d,
                    [cx, cy, cx + w, cy + row_h],
                    radius=26,
                    fill=CHIP_BG,
                    outline=CHIP_BORDER, width=1,
                )
                d.text((cx + 16, cy + 12), s,
                       font=f_chip, fill=BRAND_DARK)
                cx += w + 10
            y_after_stats = cy + row_h + 24

    # -----------------------------------------------------------
    # 7) Preferred skills — wrapped inline text, not chips (keeps
    #    the poster from getting chip-heavy)
    # -----------------------------------------------------------
    pref_raw = (draft.get("PREFERRED_SKILLS") or "").strip()
    if pref_raw:
        d.text((60, y_after_stats), "GOOD TO HAVE",
               font=f_h3, fill=MUTED)
        y_after_stats += 30
        pref_pretty = " · ".join(
            s.strip() for s in pref_raw.split(",") if s.strip()
        )
        f_pref = _load_font(22, bold=False)
        pref_lines = _wrap(d, pref_pretty, f_pref, W - 120)
        for line in pref_lines[:3]:
            d.text((60, y_after_stats), line, font=f_pref, fill=INK)
            y_after_stats += 32
        y_after_stats += 8

    # -----------------------------------------------------------
    # 8) Apply-by date
    # -----------------------------------------------------------
    needed_by = _fmt_date_human(draft.get("NEEDED_BY_DATE"))
    if needed_by:
        d.text((60, y_after_stats), "APPLY BY",
               font=f_h3, fill=MUTED)
        d.text((60, y_after_stats + 30), needed_by,
               font=f_body, fill=BRAND)
        y_after_stats += 90

    # -----------------------------------------------------------
    # 9) Contact strip at the bottom
    # -----------------------------------------------------------
    strip_h = 220
    d.rectangle([0, H - strip_h, W, H], fill=BRAND_DARK)

    # Try to place the BVC logo top-left of the strip
    logo_path = Path(__file__).resolve().parent.parent.parent / "app" / "assets" / "bharath-logo.png"
    logo_x, logo_y = 60, H - strip_h + 30
    if logo_path.exists():
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo.thumbnail((110, 110), Image.LANCZOS)
            im.paste(logo, (logo_x, logo_y), logo)
        except Exception:
            pass

    f_cname = _load_font(26, bold=True)
    f_ctag  = _load_font(18, bold=False)
    f_cline = _load_font(20, bold=False)

    text_x = logo_x + 130
    d.text((text_x, H - strip_h + 30),
           company["name"], font=f_cname, fill=(255, 255, 255))
    d.text((text_x, H - strip_h + 65),
           company.get("tagline") or "", font=f_ctag, fill=(255, 220, 200))

    email = company.get("careers_email") or ""
    phone = company.get("phone") or ""
    if email:
        d.text((text_x, H - strip_h + 100),
               f"Send resume:  {email}", font=f_cline, fill=(255, 255, 255))
    if phone:
        d.text((text_x, H - strip_h + 130),
               f"Call:  {phone}", font=f_cline, fill=(255, 220, 200))

    # Address at the very bottom, wrapped
    address = company.get("address") or ""
    if address:
        addr_lines = _wrap(d, address, f_ctag, W - 120)
        ay = H - 60 - (len(addr_lines) - 1) * 22
        for line in addr_lines:
            d.text((60, ay), line, font=f_ctag, fill=(255, 220, 200))
            ay += 22

    # Encode to PNG
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
