"""Matches an inbound WhatsApp wa_id to a Lead record. Lead.CONTACT_MOBILE is
unvalidated free text (no format enforced anywhere in the app — see
lead_models.py), so this is best-effort, not exact-match.

Per the confirmed product decision: when more than one Lead shares a phone
number for a vendor, the most recently created one wins."""
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.lead_models import Lead
from app.utils.phone_utils import msisdn_candidates, last_n_digits


def resolve_lead_for_wa_id(db: Session, vendor_id: int, wa_id: str, default_country_code: str = "91") -> Optional[Lead]:
    candidates = msisdn_candidates(wa_id, default_country_code)
    if not candidates:
        return None

    # Stage 1 — indexed fast path (uses ix_lead_mobile), covers the large
    # majority of real, cleanly-entered numbers.
    lead = (
        db.query(Lead)
        .filter(Lead.VENDOR_ID == vendor_id, Lead.CONTACT_MOBILE.in_(candidates))
        .order_by(Lead.CREATED_AT.desc())
        .first()
    )
    if lead:
        return lead

    # Stage 2 — only on a stage-1 miss: normalize CONTACT_MOBILE in SQL and
    # compare the last 10 digits. Unindexed, but only runs on misses, and
    # inbound WhatsApp volume is human-paced.
    last10 = last_n_digits(wa_id, 10)
    if not last10:
        return None

    normalized = Lead.CONTACT_MOBILE
    for ch in (" ", "-", "+", "(", ")", "."):
        normalized = func.replace(normalized, ch, "")

    return (
        db.query(Lead)
        .filter(Lead.VENDOR_ID == vendor_id, Lead.CONTACT_MOBILE.isnot(None), normalized.like(f"%{last10}"))
        .order_by(Lead.CREATED_AT.desc())
        .first()
    )
