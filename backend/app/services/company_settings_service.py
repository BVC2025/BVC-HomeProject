"""Admin Module 3 — Company Master Settings.

Single source of truth for company branding used across:
  - Quotation PDF (header + footer)
  - Sales Order / Invoice prints
  - Purchase Order prints
  - GRN prints
  - Payslip PDF
  - Reports cover pages

Auto-seeds a default row for VENDOR_ID=1 with BVC's legacy hardcoded
values on first access, so existing deployments don't break.
"""

from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import CompanyMaster


# ---- Defaults (legacy BVC values used as the seed row) --------------

DEFAULT_COMPANY = {
    "LEGAL_NAME":           "Bharath Vending Corporation",
    "SHORT_NAME":           "BVC24",
    "TAGLINE":              "Manufacturing Management System",
    "GST_NUMBER":           "33ABCDE1234F1Z5",
    "PAN_NUMBER":           "ABCDE1234F",
    "CIN_NUMBER":           None,
    "ADDRESS_LINE_1":       "Plot No. 14, Industrial Estate",
    "ADDRESS_LINE_2":       None,
    "CITY":                 "Chennai",
    "STATE":                "Tamil Nadu",
    "PINCODE":              "600032",
    "COUNTRY":              "India",
    "EMAIL":                "contact@bvc24.in",
    "PHONE":                "+91 90000 12345",
    "WEBSITE":              "www.bvc24.in",
    "BANK_NAME":            None,
    "BANK_ACCOUNT_NUMBER":  None,
    "BANK_IFSC":            None,
    "BANK_BRANCH":          None,
    "UPI_ID":               None,
    "LOGO_URL":             None,
    "NOTES":                None,
}


# ---- Helpers --------------------------------------------------------

def get_company_settings(
    db: Session,
    vendor_id: int = 1
) -> CompanyMaster:
    """Returns the CompanyMaster row for the given vendor, auto-seeding
    it with DEFAULT_COMPANY on first access. Never returns None — the
    row is guaranteed to exist after this call."""

    row = db.query(CompanyMaster).filter(
        CompanyMaster.VENDOR_ID == vendor_id
    ).first()

    if row:

        return row

    row = CompanyMaster(VENDOR_ID=vendor_id, **DEFAULT_COMPANY)

    db.add(row)

    db.commit()

    db.refresh(row)

    return row


def serialize_company(c: CompanyMaster) -> dict:

    return {
        "ID":                  c.ID,
        "VENDOR_ID":           c.VENDOR_ID,
        "LEGAL_NAME":          c.LEGAL_NAME,
        "SHORT_NAME":          c.SHORT_NAME,
        "TAGLINE":             c.TAGLINE,
        "GST_NUMBER":          c.GST_NUMBER,
        "PAN_NUMBER":          c.PAN_NUMBER,
        "CIN_NUMBER":          c.CIN_NUMBER,
        "ADDRESS_LINE_1":      c.ADDRESS_LINE_1,
        "ADDRESS_LINE_2":      c.ADDRESS_LINE_2,
        "CITY":                c.CITY,
        "STATE":               c.STATE,
        "PINCODE":             c.PINCODE,
        "COUNTRY":             c.COUNTRY,
        "EMAIL":               c.EMAIL,
        "PHONE":               c.PHONE,
        "WEBSITE":             c.WEBSITE,
        "BANK_NAME":           c.BANK_NAME,
        "BANK_ACCOUNT_NUMBER": c.BANK_ACCOUNT_NUMBER,
        "BANK_IFSC":           c.BANK_IFSC,
        "BANK_BRANCH":         c.BANK_BRANCH,
        "UPI_ID":              c.UPI_ID,
        "LOGO_URL":            c.LOGO_URL,
        "NOTES":               c.NOTES,
        "UPDATED_AT": (
            c.UPDATED_AT.isoformat()
            if c.UPDATED_AT else None
        ),
    }


def format_full_address(c: CompanyMaster) -> str:
    """Returns the company address as a single comma-joined line —
    useful for PDF footers."""

    parts = [
        c.ADDRESS_LINE_1,
        c.ADDRESS_LINE_2,
        c.CITY,
        c.STATE,
        c.PINCODE,
        c.COUNTRY,
    ]

    return ", ".join(p.strip() for p in parts if p and p.strip())
