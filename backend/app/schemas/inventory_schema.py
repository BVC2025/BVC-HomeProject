from pydantic import BaseModel
from typing import Optional


class InventoryCreate(BaseModel):

    PRODUCT_ID: Optional[str] = None
    MATERIAL_NAME: Optional[str] = None
    QUANTITY: int
    UNIT_PRICE: float
    VENDOR_ID: int


class StockUpdate(BaseModel):

    QUANTITY: int
