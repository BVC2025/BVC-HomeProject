from typing import Optional

from pydantic import BaseModel


class BiometricScanRequest(BaseModel):
    """
    Normalized device push payload. Both ZKTeco and eSSL/Mantra
    SDKs can be mapped to this shape on the device-bridge side
    (e.g. a small TCP listener that forwards to this endpoint).

    For demo/testing, the frontend builds this same payload and
    posts it directly — so the flow works with or without real
    hardware attached.
    """

    DEVICE_ID: str
    FINGERPRINT_ID: str
    VERIFY_MODE: Optional[str] = "FP"   # FP / FACE / CARD / PWD
    TIMESTAMP: Optional[str] = None     # ISO8601; defaults to now
    RAW_PAYLOAD: Optional[str] = None
    VENDOR_ID: Optional[int] = 1


class BiometricEnrollRequest(BaseModel):
    """Maps an existing employee to a device-side fingerprint ID."""

    EMPLOYEE_ID: str
    FINGERPRINT_ID: str
    DEVICE_ID: Optional[str] = None
