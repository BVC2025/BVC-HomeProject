from pydantic import BaseModel
from typing import Optional


class MovementFilter(BaseModel):
    vendor_id: int = 1
    item_id: Optional[str] = None
    movement_type: Optional[str] = None
    reference_type: Optional[str] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    page: int = 1
    page_size: int = 50
