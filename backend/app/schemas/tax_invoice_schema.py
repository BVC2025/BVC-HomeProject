from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class TaxInvoiceBase(BaseModel):
    CUSTOMER_ID: str
    TAX_ID:str
    IRN: str
    ACK_NO: str
    ACK_DATE: str
    INVOICE_NUMBER: str
    EWAY_BILL_NO: str
    DATED: Optional[str] = None
    DELIVERY_NOTE: Optional[str] = None
    MODERN_TERMS_OF_PAYMENT: Optional[str] = None
    REFERENCE_No_DATE: Optional[str] = None
    OTHER_REFERENCE: Optional[str] = None
    BUYER_ORDER_NUMBER: Optional[str] = None
    DISPATCH_DOC_NUMBER: Optional[str] = None
    DELIVERY_NOTE_DATE: Optional[str] = None
    DISPATCHED_THROUGH: Optional[str] = None
    DESTINATION: Optional[str] = None
    BILL_OF_LANDING: Optional[str] = None
    LR_RR_NO: Optional[str] = None
    MOTOR_VEHICLE_NUMBER: Optional[str] = None
    TERMS_OF_DELIVERY: Optional[str] = None
    HOME_ADDRESS: str
    SHIP_TO: str
    BILL_TO: str
    DESCRIPTION: List[Dict[str, Any]]
    HSN: str
    TOTAL_QTY: int
    TOTAL_AMOUNT: float
    TOTAL_AMOUNT_IN_WORDS: str
    TOTAL_GST_PERCENT: str
    CGST: str
    SGST: str
    TAX_AMOUNT: float
    TAX_AMOUNT_IN_WORDS: str
    DECLARATION: Optional[str] = None


class TaxInvoiceCreate(TaxInvoiceBase):
    pass



class TaxInvoiceUpdate(BaseModel):
    TAX_ID:Optional[str] = None
    CUSTOMER_ID: Optional[str] = None
    IRN: Optional[str] = None
    ACK_NO: Optional[str] = None
    ACK_DATE: Optional[str] = None
    INVOICE_NUMBER: Optional[str] = None
    EWAY_BILL_NO: Optional[str] = None
    DATED: Optional[str] = None
    DELIVERY_NOTE: Optional[str] = None
    Modern_TERMS_OF_PAYMENT: Optional[str] = None
    REFERENCE_No_DATE: Optional[str] = None
    OTHER_REFERENCE: Optional[str] = None
    BUYER_ORDER_NUMBER: Optional[str] = None
    DISPATCH_DOC_NUMBER: Optional[str] = None
    DELIVERY_NOTE_DATE: Optional[str] = None
    DISPATCHED_THROUGH: Optional[str] = None
    DESTINATION: Optional[str] = None
    BILL_OF_LANDING: Optional[str] = None
    LR_RR_NO: Optional[str] = None
    MOTOR_VEHICLE_NUMBER: Optional[str] = None
    TERMS_OF_DELIVERY: Optional[str] = None
    HOME_ADDRESS: Optional[str] = None
    SHIP_TO: Optional[str] = None
    BILL_TO: Optional[str] = None
    DESCRIPTION: Optional[List[Dict[str, Any]]] = None
    HSN: Optional[str] = None
    TOTAL_QTY: Optional[int] = None
    TOTAL_AMOUNT: Optional[float] = None
    TOTAL_AMOUNT_IN_WORDS: Optional[str] = None
    TOTAL_GST_PERCENT: Optional[str] = None
    CGST: Optional[str] = None
    SGST: Optional[str] = None
    TAX_AMOUNT: Optional[float] = None
    TAX_AMOUNT_IN_WORDS: Optional[str] = None
    DECLARATION: Optional[str] = None


class TaxInvoiceresponse(TaxInvoiceBase):
    ID:str

    class Config:
        from_attributes = True













    