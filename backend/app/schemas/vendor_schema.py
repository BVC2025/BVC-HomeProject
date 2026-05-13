from pydantic import BaseModel


class VendorCreate(BaseModel):

    VENDOR_NAME: str