from pydantic import BaseModel


class RoleCreate(BaseModel):

    ROLE_NAME: str
    VENDOR_ID: int


class EmployeeCreate(BaseModel):

    NAME: str
    EMAIL: str
    PASSWORD: str
    ROLE_ID: int
    VENDOR_ID: int