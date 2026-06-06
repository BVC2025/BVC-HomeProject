from typing import Optional

from pydantic import BaseModel


class CheckInRequest(BaseModel):

    EMPLOYEE_ID: str
    VENDOR_ID: int = 1
    # ---- Geofence (optional — back-compat with legacy callers) ----
    LATITUDE:     Optional[float] = None
    LONGITUDE:    Optional[float] = None
    DEVICE_INFO:  Optional[str]   = None
    BROWSER_INFO: Optional[str]   = None


class CheckOutRequest(BaseModel):

    EMPLOYEE_ID: str
    LATITUDE:    Optional[float] = None
    LONGITUDE:   Optional[float] = None
    DEVICE_INFO: Optional[str]   = None


class MarkAbsentRequest(BaseModel):

    EMPLOYEE_ID: str
    VENDOR_ID: int = 1
    NOTE: Optional[str] = None
