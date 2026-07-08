from app.models.models import TaxInvoiceTable
from sqlalchemy.orm import Session
from app.schemas.tax_invoice_schema import TaxInvoiceCreate,TaxInvoiceUpdate
from uuid import uuid4
from typing import Optional

def create_tax_invoice(db:Session,data:TaxInvoiceCreate):
    str_id=uuid4().hex[:12]
    entry=TaxInvoiceTable(**data.dict(),ID=str_id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry

def get_all_tax_invoice(db:Session):
    return db.query(TaxInvoiceTable).all()

def get_tax_invoice_by_id(db:Session,ID:str):
    return db.query(TaxInvoiceTable).filter(TaxInvoiceTable.ID == ID).first()

def get_tax_by_filter(db:Session,CUSTOMER_ID:Optional[str]=None,INVOICE_NUMBER:Optional[str]=None,EWAY_BILL_NO:Optional[str]=None):
    query=db.query(TaxInvoiceTable)

    if CUSTOMER_ID:
        query=query.filter(TaxInvoiceTable.CUSTOMER_ID == CUSTOMER_ID)

    if INVOICE_NUMBER:
        query = query.filter(TaxInvoiceTable.INVOICE_NUMBER == INVOICE_NUMBER)

    if EWAY_BILL_NO:
        query = query.filter(TaxInvoiceTable.EWAY_BILL_NO == EWAY_BILL_NO)

    return query.all()


def Update_tax_service(db:Session,data:TaxInvoiceUpdate,ID:str):#loop through
    entry=get_tax_invoice_by_id(db,ID)
    if not entry:
        return None
    
    for key,value in data.dict(exclude_defaults=True).items():
        setattr(entry,key,value)

    db.commit()
    db.refresh(entry)
    return entry


def delete_the_tax_invoice(db:Session,ID:str):
    entry=get_tax_invoice_by_id(db,ID)
    if not entry:
        return None
    
    db.delete(entry)
    db.commit()
    
    return True

