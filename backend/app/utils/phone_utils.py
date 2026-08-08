"""Phone-number normalization for matching WhatsApp wa_id values (Meta sends
digits-only, country-code-prefixed, no '+') against Lead.CONTACT_MOBILE,
which is unvalidated free text (no format enforced anywhere in the app)."""
import re
from typing import List


def normalize_msisdn(raw: str, default_country_code: str = "91") -> str:
    """Best-effort normalization to a digits-only, country-code-prefixed
    number, matching the shape Meta's Cloud API expects for a 'to' address."""
    digits = re.sub(r"\D", "", raw or "")

    if digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) > 10:
        digits = digits[1:]

    if len(digits) == 10:
        digits = f"{default_country_code}{digits}"

    return digits


def last_n_digits(raw: str, n: int = 10) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits[-n:] if len(digits) >= n else digits


def msisdn_candidates(wa_id: str, default_country_code: str = "91") -> List[str]:
    """Generates plausible free-text forms a human might have typed for this
    wa_id, for an indexed IN-list lookup against Lead.CONTACT_MOBILE."""
    digits = re.sub(r"\D", "", wa_id or "")
    if not digits:
        return []

    last10 = last_n_digits(digits, 10)
    cc = default_country_code

    candidates = {
        digits,
        f"+{digits}",
        last10,
        f"0{last10}",
        f"{cc}{last10}",
        f"+{cc}{last10}",
        f"+{cc} {last10}",
        f"+{cc}-{last10}",
    }
    return [c for c in candidates if c]
