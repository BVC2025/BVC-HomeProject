from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class EwayBase(BaseModel):
    DOC_NO: str
    CUSTOMER_ID:str
    DATE: str
    IRN: str
    ACK_NO: str
    ACK_DATE: str
    EWAYBILLNO: str
    GENERATD_BY: str
    SUPPLYTYPE: str
    GENERATED_DATE_TIME: str
    VALID_UPTO: str
    FROM: str
    TO: str
    DIPATCH_FROM: str
    SHIP_TO: str
    HSN_CODE: int
    PRODUCTNAME_DESC: List[Dict[str, Any]]
    QUANTITY: int
    TAXABLEAMT: float
    TAX_RATE_CS: str
    TOTAL_TAX_AMOUNT: str
    TOTAL_INV_AMT: str
    TRANSPORTER_ID: str
    NAME: Optional[str] = None
    VEHICLE_NUMBER: Optional[str] = None
    PINCODE: Optional[str] = None
    CEWB: Optional[str] = None


class EwayCreate(EwayBase):
    pass


class EwayUpdate(BaseModel):
    CUSTOMER_ID:Optional[str] = None
    DOC_NO: Optional[str] = None
    DATE: Optional[str] = None
    IRN: Optional[str] = None
    ACK_NO: Optional[str] = None
    ACK_DATE: Optional[str] = None
    EWAYBILLNO: Optional[str] = None
    GENERATD_BY: Optional[str] = None
    SUPPLYTYPE: Optional[str] = None
    GENERATED_DATE_TIME: Optional[str] = None
    VALID_UPTO: Optional[str] = None
    FROM: Optional[str] = None
    TO: Optional[str] = None
    DIPATCH_FROM: Optional[str] = None
    SHIP_TO: Optional[str] = None
    HSN_CODE: Optional[int] = None
    PRODUCTNAME_DESC: Optional[List[Dict[str, Any]]] = None
    QUANTITY: Optional[int] = None
    TAXABLEAMT: Optional[float] = None
    TAX_RATE_CS: Optional[str] = None
    TOTAL_TAX_AMOUNT: Optional[str] = None
    TOTAL_INV_AMT: Optional[str] = None
    TRANSPORTER_ID: Optional[str] = None
    NAME: Optional[str] = None
    VEHICLE_NUMBER: Optional[str] = None
    PINCODE: Optional[str] = None
    CEWB: Optional[str] = None


class EwayResponse(EwayBase):
    ID: str

    class Config:
        from_attributes = True