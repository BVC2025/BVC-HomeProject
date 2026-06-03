from typing import Optional

from pydantic import BaseModel


class MachineCreate(BaseModel):

    MACHINE_NAME: str
    MACHINE_TYPE: str
    LOCATION: Optional[str] = None
    STATUS: Optional[str] = "IDLE"
    VENDOR_ID: int = 1


class MachineStatusUpdate(BaseModel):

    STATUS: str
    NOTE: Optional[str] = None
