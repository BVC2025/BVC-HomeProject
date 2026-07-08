from fastapi import APIRouter,Depends
from sqlalchemy.orm import Session
from app.database.database import get_db
from app.schemas.tax_invoice_schema import TaxInvoiceCreate,TaxInvoiceresponse,TaxInvoiceUpdate
from app.services import tax_invoice_services
from typing import Optional

tax_router_bp=APIRouter(
    prefix="/tax/invoice",
    tags=["Tax Invoice"]

)



@tax_router_bp.post("/add")
def create_tax_ivoice(data:TaxInvoiceCreate,db:Session=Depends(get_db)):
    try:
        result=tax_invoice_services.create_tax_invoice(db,data)
        return {
            "message":"tax invoice generated successfully",
            "status":True,
            "data":result
        }
    except Exception as e:
        return {
            "message":"failed to update",
            "status":False,
            "error":str(e)
        }


@tax_router_bp.get("/all")
def get_all_ax_invoice_route(db:Session=Depends(get_db)):
    try:
        result=tax_invoice_services.get_all_tax_invoice(db)
        return{
            "message":"tax invoice data fetched successfully",
            "status":True,
            "data":result
        }
    except Exception as e:
        return {
            "message":"failed to update",
            "status":False,
            "error":str(e)
        }


@tax_router_bp.get("/apply/filter")
def get_filter_invoice_route(CUSTOMER_ID:Optional[str]=None,INVOICE_NUMBER:Optional[str]=None,EWAY_BILL_NO:Optional[str]=None,db:Session=Depends(get_db)):
    try:
        result=tax_invoice_services.get_tax_by_filter(
            db,
            CUSTOMER_ID,
            INVOICE_NUMBER,
            EWAY_BILL_NO
        )

        return {
            "message":"tax invoice fetched correctly",
            "status":True,
            "data":result
        }
    except Exception as e:
        return {
            "message":"failed to update",
            "status":False,
            "error":str(e)
        }


@tax_router_bp.put("/update/{ID}")
def update_invoice_route(data:TaxInvoiceUpdate,ID:str,db:Session=Depends(get_db)):
    try:
        result=tax_invoice_services.Update_tax_service(db,data,ID)
        return {
            "message":"tax invoice updated successfully",
            "status":True,
            "data":result
        }
    except Exception as e:
        return {
            "message":"failed to update",
            "status":False,
            "error":str(e)
        }


@tax_router_bp.delete("/delete/{ID}")
def delete_invoice_route(ID:str,db:Session=Depends(get_db)):
    try:
        result=tax_invoice_services.delete_the_tax_invoice(ID,db)
        return{
            "message":"tax invoice Deleted successfully",
            "status":True,
            "data":result
        }
    except Exception as e:
        return {
            "message":"failed to update",
            "status":False,
            "error":str(e)
        }


    

