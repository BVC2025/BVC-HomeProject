from pydantic import BaseModel
from typing import Optional, List


# =========================
# DEPARTMENT
# =========================

class DepartmentCreate(BaseModel):
    NAME: str
    DEPARTMENT_CODE: str
    DESCRIPTION: Optional[str] = None
    VENDOR_ID: int = 1


class DepartmentUpdate(BaseModel):
    NAME: Optional[str] = None
    DEPARTMENT_CODE: Optional[str] = None
    DESCRIPTION: Optional[str] = None


# =========================
# DESIGNATION
# =========================

class DesignationCreate(BaseModel):
    TITLE: str
    DEPARTMENT_ID: int
    BASE_SALARY: float = 0.0
    DESCRIPTION: Optional[str] = None
    VENDOR_ID: int = 1


class DesignationUpdate(BaseModel):
    TITLE: Optional[str] = None
    DEPARTMENT_ID: Optional[int] = None
    BASE_SALARY: Optional[float] = None
    DESCRIPTION: Optional[str] = None


# =========================
# ROLE (RBAC)
# =========================

class RoleCreate(BaseModel):
    NAME: str
    DESCRIPTION: Optional[str] = None
    VENDOR_ID: int = 1


class RolePermissionsSet(BaseModel):
    PERMISSION_IDS: List[int]
