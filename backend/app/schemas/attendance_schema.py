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
    # When True, the caller has explicitly bypassed the GPS gate (e.g.
    # admin marking attendance from a desktop with no real GPS hardware).
    # The backend still stores the coordinates and computes distance for
    # the audit trail, but skips the 403 reject for "outside office".
    BYPASS_GEOFENCE: bool = False


class CheckOutRequest(BaseModel):

    EMPLOYEE_ID: str
    LATITUDE:    Optional[float] = None
    LONGITUDE:   Optional[float] = None
    DEVICE_INFO: Optional[str]   = None
    BYPASS_GEOFENCE: bool = False


class MarkAbsentRequest(BaseModel):

    EMPLOYEE_ID: str
    VENDOR_ID: int = 1
    NOTE: Optional[str] = None
