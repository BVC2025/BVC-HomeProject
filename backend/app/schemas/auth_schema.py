from pydantic import BaseModel

class RootUserCreate(BaseModel):
    EMAIL: str
    PASSWORD: str
    VENDOR_ID: int



class LoginSchema(BaseModel):
    EMAIL: str
    PASSWORD: str    