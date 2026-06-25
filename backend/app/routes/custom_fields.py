from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List, Any
from pydantic import BaseModel

from app.database.database import get_db
from app.models.models import CustomField, CustomFieldTableValue

router = APIRouter()


# =========================
# SCHEMAS
# =========================

class CustomFieldCreate(BaseModel):
    TABLE_NAME: str
    FIELD_NAME: str
    FIELD_TYPE: str
    OPTIONS: Optional[List[Any]] = None
    IS_REQUIRED: bool = False
    SORT_ORDER: int = 0
    VENDOR_ID: int = 1


class CustomFieldUpdate(BaseModel):
    FIELD_NAME: Optional[str] = None
    FIELD_TYPE: Optional[str] = None
    OPTIONS: Optional[List[Any]] = None
    IS_REQUIRED: Optional[bool] = None
    SORT_ORDER: Optional[int] = None


class FieldValueUpsert(BaseModel):
    TABLE_NAME: str
    TABLE_ROW_ID: str
    CUSTOM_FIELD_ID: str
    CUSTOM_FIELD_VALUE: Optional[Any] = None


class ReorderField(BaseModel):
    id: str
    sort_order: int


# =========================
# CUSTOM FIELDS CRUD
# =========================

@router.get("/custom-fields")
def list_custom_fields(
    table_name: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(CustomField)
    if table_name:
        q = q.filter(CustomField.TABLE_NAME == table_name)
    if vendor_id is not None:
        q = q.filter(CustomField.VENDOR_ID == vendor_id)
    rows = q.order_by(CustomField.TABLE_NAME, CustomField.SORT_ORDER, CustomField.FIELD_NAME).all()
    return [
        {
            "ID": f.ID,
            "TABLE_NAME": f.TABLE_NAME,
            "FIELD_NAME": f.FIELD_NAME,
            "FIELD_TYPE": f.FIELD_TYPE,
            "OPTIONS": f.OPTIONS,
            "IS_REQUIRED": f.IS_REQUIRED,
            "SORT_ORDER": f.SORT_ORDER,
            "VENDOR_ID": f.VENDOR_ID,
            "CREATED_AT": f.CREATED_AT.isoformat() if f.CREATED_AT else None,
            "UPDATED_AT": f.UPDATED_AT.isoformat() if f.UPDATED_AT else None
        }
        for f in rows
    ]


@router.post("/custom-fields")
def create_custom_field(
    data: CustomFieldCreate,
    db: Session = Depends(get_db)
):
    field = CustomField(
        TABLE_NAME=data.TABLE_NAME,
        FIELD_NAME=data.FIELD_NAME,
        FIELD_TYPE=data.FIELD_TYPE,
        OPTIONS=data.OPTIONS,
        IS_REQUIRED=data.IS_REQUIRED,
        SORT_ORDER=data.SORT_ORDER,
        VENDOR_ID=data.VENDOR_ID
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return {"message": "Custom field created", "ID": field.ID}


@router.put("/custom-fields/{field_id}")
def update_custom_field(
    field_id: str,
    data: CustomFieldUpdate,
    db: Session = Depends(get_db)
):
    field = db.query(CustomField).filter(CustomField.ID == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Custom field not found")
    if data.FIELD_NAME is not None:
        field.FIELD_NAME = data.FIELD_NAME
    if data.FIELD_TYPE is not None:
        field.FIELD_TYPE = data.FIELD_TYPE
    if data.OPTIONS is not None:
        field.OPTIONS = data.OPTIONS
    if data.IS_REQUIRED is not None:
        field.IS_REQUIRED = data.IS_REQUIRED
    if data.SORT_ORDER is not None:
        field.SORT_ORDER = data.SORT_ORDER
    db.commit()
    return {"message": "Custom field updated"}


@router.delete("/custom-fields/{field_id}")
def delete_custom_field(
    field_id: str,
    db: Session = Depends(get_db)
):
    field = db.query(CustomField).filter(CustomField.ID == field_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="Custom field not found")
    value_count = db.query(CustomFieldTableValue).filter(
        CustomFieldTableValue.CUSTOM_FIELD_ID == field_id
    ).count()
    if value_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {value_count} value(s) exist for this field. Clear values first."
        )
    db.delete(field)
    db.commit()
    return {"message": "Custom field deleted"}


@router.patch("/custom-fields/reorder")
def reorder_custom_fields(
    items: List[ReorderField],
    db: Session = Depends(get_db)
):
    for item in items:
        field = db.query(CustomField).filter(CustomField.ID == item.id).first()
        if field:
            field.SORT_ORDER = item.sort_order
    db.commit()
    return {"message": f"Reordered {len(items)} fields"}


# =========================
# CUSTOM FIELD VALUES
# =========================

@router.get("/custom-field-values")
def get_field_values(
    table_name: str = Query(...),
    row_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    q = db.query(CustomFieldTableValue, CustomField).join(
        CustomField, CustomFieldTableValue.CUSTOM_FIELD_ID == CustomField.ID
    ).filter(CustomFieldTableValue.TABLE_NAME == table_name)
    if row_id:
        q = q.filter(CustomFieldTableValue.TABLE_ROW_ID == row_id)
    rows = q.all()
    return [
        {
            "ID": v.ID,
            "TABLE_NAME": v.TABLE_NAME,
            "TABLE_ROW_ID": v.TABLE_ROW_ID,
            "CUSTOM_FIELD_ID": v.CUSTOM_FIELD_ID,
            "FIELD_NAME": f.FIELD_NAME,
            "FIELD_TYPE": f.FIELD_TYPE,
            "CUSTOM_FIELD_VALUE": v.CUSTOM_FIELD_VALUE,
            "CREATED_AT": v.CREATED_AT.isoformat() if v.CREATED_AT else None,
            "UPDATED_AT": v.UPDATED_AT.isoformat() if v.UPDATED_AT else None
        }
        for v, f in rows
    ]


@router.post("/custom-field-values")
def upsert_field_value(
    data: FieldValueUpsert,
    db: Session = Depends(get_db)
):
    existing = db.query(CustomFieldTableValue).filter(
        CustomFieldTableValue.TABLE_NAME == data.TABLE_NAME,
        CustomFieldTableValue.TABLE_ROW_ID == data.TABLE_ROW_ID,
        CustomFieldTableValue.CUSTOM_FIELD_ID == data.CUSTOM_FIELD_ID
    ).first()
    if existing:
        existing.CUSTOM_FIELD_VALUE = data.CUSTOM_FIELD_VALUE
        db.commit()
        return {"message": "Value updated", "ID": existing.ID}
    val = CustomFieldTableValue(
        TABLE_NAME=data.TABLE_NAME,
        TABLE_ROW_ID=data.TABLE_ROW_ID,
        CUSTOM_FIELD_ID=data.CUSTOM_FIELD_ID,
        CUSTOM_FIELD_VALUE=data.CUSTOM_FIELD_VALUE
    )
    db.add(val)
    db.commit()
    db.refresh(val)
    return {"message": "Value created", "ID": val.ID}


@router.delete("/custom-field-values/{value_id}")
def delete_field_value(
    value_id: str,
    db: Session = Depends(get_db)
):
    val = db.query(CustomFieldTableValue).filter(
        CustomFieldTableValue.ID == value_id
    ).first()
    if not val:
        raise HTTPException(status_code=404, detail="Value not found")
    db.delete(val)
    db.commit()
    return {"message": "Value deleted"}
