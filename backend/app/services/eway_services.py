from app.models.models import EwayBillTable
from sqlalchemy.orm import Session
from app.database.database import get_db
from app.schemas.eway_bill_schemas import EwayCreate,EwayUpdate
from typing import Optional
from uuid import uuid4


def create_eway_bill(db:Session,data:EwayCreate):
        str_id=uuid4().hex[:12]
        entry=EwayBillTable(**data.dict(),ID=str_id)
        db.add(entry)
        db.commit()
        db.refresh(entry)

        return entry

def get_all_eway_bill(db:Session):
        return db.query(EwayBillTable).all()

def get_by_eway_id(db:Session,ID:str):
       return db.query(EwayBillTable).filter(EwayBillTable.ID == ID).first()

def get_eway_bill_by_filter(db:Session,TAX_ID:Optional[str]=None,CUSTOMER_ID:Optional[str]=None,DOC_NO:Optional[str]=None,EWAYBILLNO:Optional[str]=None):
       
       Query=db.query(EwayBillTable)

       if CUSTOMER_ID:
            query=Query.filter(EwayBillTable.CUSTOMER_ID == CUSTOMER_ID)

       if DOC_NO:
              query=Query.filter(EwayBillTable.DOC_NO == DOC_NO)

       if EWAYBILLNO:
              query=Query.filter(EwayBillTable.EWAYBILLNO == EWAYBILLNO)

       if TAX_ID:
              query=Query.filter(EwayBillTable.TAX_ID == TAX_ID)

       return query.all()

def update_eway_bill(db:Session,data:EwayUpdate,ID:str):
       entry = get_by_eway_id(db,ID)
       if not entry:
              return None
       
       for key,value in data.dict(exclude_defaults=True).items():
              setattr(entry,key,value)

       db.commit()
       db.refresh(entry)
       return entry

def delete_eway_bill(db:Session,ID:str):
       entry = get_by_eway_id(db,ID)
       if not entry:
              return None
       
       db.delete(entry)
       db.commit()

       return True
       
       
        

        
        
        
        
               

    
        
        
    
