from pydantic import BaseModel
from typing import Optional, List


# =========================
# DEPARTMENT
# =========================

class DepartmentCreate(BaseModel):
    NAME: str
    DEPARTMENT_CODE: str
    DESCRIPTION: Optional[str] = None
    HEAD_EMPLOYEE_ID: Optional[str] = None
    VENDOR_ID: int = 1


class DepartmentUpdate(BaseModel):
    NAME: Optional[str] = None
    DEPARTMENT_CODE: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    HEAD_EMPLOYEE_ID: Optional[str] = None
    STATUS: Optional[str] = None


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
    STATUS: Optional[str] = None


# =========================
# BRANCH / LOCATION
# =========================

class BranchCreate(BaseModel):
    NAME: str
    BRANCH_CODE: str
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    COUNTRY: Optional[str] = None
    PINCODE: Optional[str] = None
    PHONE: Optional[str] = None
    EMAIL: Optional[str] = None
    MANAGER_EMPLOYEE_ID: Optional[str] = None
    LATITUDE: Optional[float] = None
    LONGITUDE: Optional[float] = None
    VENDOR_ID: int = 1


class BranchUpdate(BaseModel):
    NAME: Optional[str] = None
    BRANCH_CODE: Optional[str] = None
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    COUNTRY: Optional[str] = None
    PINCODE: Optional[str] = None
    PHONE: Optional[str] = None
    EMAIL: Optional[str] = None
    MANAGER_EMPLOYEE_ID: Optional[str] = None
    LATITUDE: Optional[float] = None
    LONGITUDE: Optional[float] = None
    STATUS: Optional[str] = None


# =========================
# ROLE (RBAC)
# =========================

class RoleCreate(BaseModel):
    ROLE_NAME: str
    CODE: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    VENDOR_ID: int = 1


class RolePermissionsSet(BaseModel):
    PERMISSION_IDS: List[int]
