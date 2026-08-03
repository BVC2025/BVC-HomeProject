"""Field-level encryption for the WhatsApp Cloud API vendor config table.

Scoped deviation from this codebase's usual "plain-text; masked in all read
responses" secret-storage convention (see LeadPollingConfig.PULL_API_KEY,
VendorEmailConfig.SMTP_PASSWORD) — the Meta permanent access token and app
secret are unusually sensitive (they grant send-as-business capability), so
they are encrypted at rest with Fernet. Every other secret in the codebase is
unaffected; this module is not used anywhere else.

Key source: WA_ENCRYPTION_KEY (a urlsafe-base64 32-byte Fernet key) in
backend/.env. Rotation is supported via the optional WA_ENCRYPTION_KEYS_OLD
(comma-separated previous keys) — MultiFernet decrypts with any of them but
always (re-)encrypts with the newest.
"""
import os
from typing import Optional

_PREFIX = "fernet$v1$"


def _load_fernet():
    from cryptography.fernet import Fernet, MultiFernet

    primary = (os.getenv("WA_ENCRYPTION_KEY") or "").strip()
    if not primary:
        return None

    keys = [primary]
    old = (os.getenv("WA_ENCRYPTION_KEYS_OLD") or "").strip()
    if old:
        keys.extend(k.strip() for k in old.split(",") if k.strip())

    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except Exception:
        return None


def is_encryption_configured() -> bool:
    return _load_fernet() is not None


def encrypt_secret(plain: str) -> str:
    """Encrypts a plaintext secret. Raises RuntimeError if WA_ENCRYPTION_KEY is
    not configured — callers must fail closed, never persist plaintext."""
    if plain is None:
        return None

    fernet = _load_fernet()
    if fernet is None:
        raise RuntimeError(
            "WA_ENCRYPTION_KEY is not configured in backend/.env — cannot store "
            "WhatsApp credentials securely."
        )

    token = fernet.encrypt(plain.encode()).decode()
    return f"{_PREFIX}{token}"


def decrypt_secret(stored: Optional[str]) -> Optional[str]:
    """Decrypts a value previously written by encrypt_secret. Raises
    RuntimeError if the key is unavailable or the value isn't in the expected
    fernet$v1$ scheme — a bare/plaintext value here is treated as corruption,
    never silently accepted."""
    if stored is None:
        return None

    if not stored.startswith(_PREFIX):
        raise ValueError(
            "Stored value is not in the expected fernet$v1$ encryption scheme."
        )

    fernet = _load_fernet()
    if fernet is None:
        raise RuntimeError(
            "WA_ENCRYPTION_KEY is not configured in backend/.env — cannot "
            "decrypt stored WhatsApp credentials."
        )

    token = stored[len(_PREFIX):]
    return fernet.decrypt(token.encode()).decode()


def fingerprint(plain: str) -> str:
    """Short, non-reversible identifier for a secret — lets an admin confirm
    *which* token is loaded without ever exposing or decrypting it."""
    import hashlib

    return hashlib.sha256(plain.encode()).hexdigest()[:8]
