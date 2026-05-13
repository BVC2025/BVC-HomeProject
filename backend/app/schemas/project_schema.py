from pydantic import BaseModel


class CustomerCreate(BaseModel):

    CUSTOMER_NAME: str
    PHONE: str
    EMAIL: str
    ADDRESS: str
    VENDOR_ID: int


class ProjectCreate(BaseModel):

    PROJECT_NAME: str
    DESCRIPTION: str
    CUSTOMER_ID: int
    VENDOR_ID: int