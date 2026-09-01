"""
Shared company-logo CID-embedding pipeline for outbound emails.

Relocated verbatim from app.routes.supplier_onboarding (the reference
implementation — Supplier emails already render the logo correctly).
Every email send path that wants a reliably-rendering company logo
(Gmail/Outlook/Apple Mail all strip base64 data URIs and many strip
external-domain <img> tags too) should use this pipeline:

  1. build_email_logo(company)          -> (logo_bytes, logo_content_type, logo_html)
  2. render_template(...)                using logo_html for the {{logo_html}} variable
  3. apply_cid_logo(html, logo_bytes, company)
  4. if not logo_bytes: extract_cid_logo(html)   # editor-baked base64 fallback
  5. send_via_vendor_smtp(..., logo_bytes=logo_bytes, logo_content_type=logo_content_type)
"""

import os
import re
import base64
from pathlib import Path


def build_email_logo(company):
    """Return (logo_bytes, logo_content_type, logo_html) for all email flows.

    Priority:
    1. Read bytes directly from the disk file (fastest, no network).
    2. Fetch bytes via HTTP from the local backend (fallback when the static
       root resolves differently at runtime — e.g. Docker volume mounts).
    3. Use the raw HTTP URL as last resort so the email still renders in
       clients that allow external images (logo will be missing in Gmail).

    Steps 1 and 2 produce a CID attachment, which is the only method that
    reliably renders a logo in Gmail, Outlook, and Apple Mail.  This matters
    especially for templates that use a {{logo_html}} placeholder in the
    catalog HTML rather than having a base64 data URI baked in by the email
    editor.
    """
    logo_bytes = None
    logo_content_type = "image/png"
    logo_url = ""

    if company.LOGO_URL:
        rel = company.LOGO_URL.split("/static/", 1)[-1]
        logo_disk = Path(__file__).resolve().parent.parent.parent / "static" / rel
        if logo_disk.exists():
            # ── Path 1: disk read ────────────────────────────────────────
            logo_bytes = logo_disk.read_bytes()
            ext = logo_disk.suffix.lower()
            logo_content_type = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".gif": "image/gif", ".webp": "image/webp",
                ".svg": "image/svg+xml",
            }.get(ext, "image/png")
            logo_url = "cid:company_logo"
        else:
            # ── Path 2: HTTP fetch from local backend ────────────────────
            # Some templates have the logo embedded as a base64 data URI by
            # the email editor, so extract_cid_logo() rescues it. Others use
            # {{logo_html}} → substituted with an HTTP URL → extract_cid_logo
            # finds nothing. Fetching here ensures both cases get CID bytes.
            backend_base = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
            http_url = (
                company.LOGO_URL if company.LOGO_URL.startswith("http")
                else f"{backend_base}{company.LOGO_URL}"
            )
            try:
                import urllib.request as _urlreq
                _rq = _urlreq.Request(
                    http_url,
                    headers={"User-Agent": "BVC24-Mailer/1.0"},
                )
                with _urlreq.urlopen(_rq, timeout=5) as _resp:
                    logo_bytes = _resp.read()
                    _ct = _resp.headers.get("Content-Type", "image/png").split(";")[0].strip()
                    logo_content_type = _ct if _ct.startswith("image/") else "image/png"
                logo_url = "cid:company_logo"
            except Exception:
                # ── Path 3: fall back to HTTP URL ────────────────────────
                logo_url = http_url

    logo_html = (
        f'<img src="{logo_url}" alt="{company.LEGAL_NAME or "Company"} Logo"'
        f' style="max-height:70px;max-width:200px;display:block;margin:0 auto 12px;" />'
    ) if logo_url else ""

    return logo_bytes, logo_content_type, logo_html


def apply_cid_logo(rendered_html: str, logo_bytes: bytes, company) -> str:
    """Rewrite all logo img src attributes in rendered HTML to use the CID reference."""
    if not (logo_bytes and company.LOGO_URL):
        return rendered_html
    logo_fname = company.LOGO_URL.rsplit("/", 1)[-1]
    CID = "cid:company_logo"

    def _ok(src):
        return (
            not src
            or logo_fname in src
            or company.LOGO_URL in src
            or src.startswith(("http://localhost", "http://127.0.0.1", "/static/company/"))
            or src.startswith("data:")
        )

    def _dq(m): return (m.group(1) + CID + m.group(3)) if _ok(m.group(2)) else m.group(0)
    def _sq(m): return (m.group(1) + CID + m.group(3)) if _ok(m.group(2)) else m.group(0)

    rendered_html = re.sub(r'(<img\b[^>]+\bsrc=")([^"]*?)(")', _dq, rendered_html, flags=re.IGNORECASE)
    rendered_html = re.sub(r"(<img\b[^>]+\bsrc=')([^']*?)(')", _sq, rendered_html, flags=re.IGNORECASE)
    return rendered_html


def extract_cid_logo(rendered_html: str):
    """Fallback when the logo file is not on disk.

    The frontend email editor bakes the logo into BODY_HTML as a base64
    data URI (``<img src="data:image/png;base64,...">``) rather than a
    ``{{logo_html}}`` placeholder.  Gmail and most email clients strip
    data URIs from received emails for security reasons.

    This function extracts the raw bytes from the first such data URI,
    replaces **all** data-URI img src values with ``cid:company_logo``,
    and returns the modified HTML together with the bytes and MIME type
    needed to attach the image as a CID part in the MIME message.

    Returns ``(original_html, None, 'image/png')`` when no data URI is
    found so callers can safely destructure the result unconditionally.
    """
    m = re.search(
        r"""<img\b[^>]+\bsrc=["'](data:image/([^;]+);base64,([^"']+))["']""",
        rendered_html,
        re.IGNORECASE,
    )
    if not m:
        return rendered_html, None, "image/png"

    mime_sub = m.group(2).lower()   # e.g. "png", "jpeg", "gif", "webp"
    b64_raw  = m.group(3).strip()
    # base64.b64decode requires padding to a multiple of 4
    pad = (4 - len(b64_raw) % 4) % 4
    try:
        logo_bytes = base64.b64decode(b64_raw + "=" * pad)
        logo_content_type = f"image/{mime_sub}"
    except Exception:
        return rendered_html, None, "image/png"

    # Rewrite all data-URI img src values to the CID reference so the
    # email client renders the CID attachment inline.
    CID = "cid:company_logo"

    def _rw(match):
        return (match.group(1) + CID + match.group(3)) if match.group(2).startswith("data:image/") else match.group(0)

    rendered_html = re.sub(r'(<img\b[^>]+\bsrc=")([^"]*?)(")', _rw, rendered_html, flags=re.IGNORECASE)
    rendered_html = re.sub(r"(<img\b[^>]+\bsrc=')([^']*?)(')", _rw, rendered_html, flags=re.IGNORECASE)
    return rendered_html, logo_bytes, logo_content_type
