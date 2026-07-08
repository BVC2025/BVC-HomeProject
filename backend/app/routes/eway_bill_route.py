from fastapi import APIRouter,Depends
from sqlalchemy.orm import Session
from app.database.database import get_db
from app.schemas.eway_bill_schemas import EwayCreate,EwayUpdate
from app.services import eway_services
from typing import Optional


eway_bill_route_bp=APIRouter(prefix="/eway/bill",tags=["Eway Bill"])


@eway_bill_route_bp.post("/add")
def add_eway_bill(data:EwayCreate,db:Session=Depends(get_db)):
    try:
        result = eway_services.create_eway_bill(db,data)

        return{
            "message":"Eway Bill Added Successfully",
            "status":True,
            "data":result
        }
    
    except Exception as e:
        return{
            "message":"Failed to add Eway Bill",
            "status":False,
            "error":str(e)
        }
    
@eway_bill_route_bp.get("/all")
def get_all_eway_bill(db:Session=Depends(get_db)):
    try:
        result=eway_services.get_all_eway_bill(db)

        return{
            "message":"Eway bill fetched Successfully",
            "status":True,
            "data":result
        }

    
    except Exception as e:
        return{
            "message":"Failed to fetch the eway bill data",
            "status":False,
            "error":str(e)
        }
    
@eway_bill_route_bp.get("/apply/filter")
def get_filter_eway_bill(TAX_ID:Optional[str]=None,CUSTOMER_ID:Optional[str]=None,DOC_NO:Optional[str]=None,EWAYBILLNO:Optional[str]=None,db:Session=Depends(get_db)):
    try:
        result=eway_services.get_eway_bill_by_filter(
            db,
            TAX_ID,
            CUSTOMER_ID,
            DOC_NO,
            EWAYBILLNO
            
        )

        return{
            "message":"Eway bill fetched Successfully",
            "status":True,
            "data":result
        }
    except Exception as e:
        return{
            "message":"Failed to fetch the eway bill data",
            "status":False,
            "error":str(e)
        }
    
@eway_bill_route_bp.put("/update/{ID}")
def update_eway_bill(data:EwayUpdate,ID:str,db:Session=Depends(get_db)):
    try:
        result =eway_services.update_eway_bill(db,data,ID)

        return{
            "message":"Eway Bill Succesfully updated",
            "status":True,
            "data":result

        }

    except Exception as e:
        return{
            "message":"Failed to update the Eway Bill",
            "status":False,
            "error":str(e)
        }
        
@eway_bill_route_bp.delete("/delete/{id}")
def delete_eway_bill(ID:str,db:Session=Depends(get_db)):
    try:
        result=eway_services.delete_eway_bill(ID,db)

        return{
            "message":"Eway Bill Deleted Successfully",
            "status":True,
            "data":result
        }
    
    except Exception as e:
        return{
            "message":"Failed to Delete the Eway Bill",
            "status":False,
            "error":str(e)
        }



        