from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import date, time


# Optional string fields that should be NULL (not "") in the database.
# Empty strings on UNIQUE columns (e.g. EMAIL) cause IntegrityError on
# the second blank entry — MySQL allows multiple NULLs, not multiple "".
_NULLABLE_STR_FIELDS = (
    "EMAIL", "PHONE",
    "ADDRESS", "CITY", "STATE", "PINCODE",
    "GENDER", "FATHER_NAME", "MOTHER_NAME", "MARITAL_STATUS",
    "OCCUPATION", "QUALIFICATION",
    "EXPERIENCE_DETAILS", "PAST_PROJECTS",
    "EMPLOYMENT_TYPE", "NOTES", "SKILLS",
    "REPORTING_MANAGER_ID", "STATUS",
    # Phase A — HR Module expansion
    "BLOOD_GROUP", "NATIONALITY",
    "EMERGENCY_CONTACT_NAME", "EMERGENCY_CONTACT_PHONE",
    "EMERGENCY_CONTACT_RELATION", "WORK_LOCATION",
    "COLLEGE", "UNIVERSITY", "PREVIOUS_COMPANY",
    "BANK_ACCOUNT_NUMBER", "BANK_NAME", "IFSC_CODE",
    "PAN_NUMBER", "AADHAAR_NUMBER"
)


class EmployeeCreate(BaseModel):

    EMPLOYEE_CODE: str
    NAME: str
    EMAIL: Optional[str] = None
    PHONE: Optional[str] = None
    PASSWORD: str
    DEPARTMENT_ID: Optional[int] = None
    DESIGNATION_ID: Optional[int] = None
    ROLE_ID: int
    REPORTING_MANAGER_ID: Optional[str] = None
    JOINING_DATE: Optional[date] = None
    SALARY: Optional[float] = 0.0
    SHIFT_START: Optional[time] = None
    SHIFT_END: Optional[time] = None
    SKILLS: Optional[str] = None
    VENDOR_ID: int = 1

    # --- New profile / resume fields ---
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    DOB: Optional[date] = None
    GENDER: Optional[str] = None
    FATHER_NAME: Optional[str] = None
    MOTHER_NAME: Optional[str] = None
    MARITAL_STATUS: Optional[str] = None
    OCCUPATION: Optional[str] = None
    QUALIFICATION: Optional[str] = None
    YEAR_OF_PASSING: Optional[int] = None
    EXPERIENCE_YEARS: Optional[float] = 0.0
    EXPERIENCE_DETAILS: Optional[str] = None
    PAST_PROJECTS: Optional[str] = None
    EMPLOYMENT_TYPE: Optional[str] = None
    NOTES: Optional[str] = None

    # --- Phase A — HR Module expansion ---
    BLOOD_GROUP: Optional[str] = None
    NATIONALITY: Optional[str] = None
    EMERGENCY_CONTACT_NAME: Optional[str] = None
    EMERGENCY_CONTACT_PHONE: Optional[str] = None
    EMERGENCY_CONTACT_RELATION: Optional[str] = None
    CONFIRMATION_DATE: Optional[date] = None
    WORK_LOCATION: Optional[str] = None
    COLLEGE: Optional[str] = None
    UNIVERSITY: Optional[str] = None
    PERCENTAGE: Optional[float] = None
    PREVIOUS_COMPANY: Optional[str] = None
    PREVIOUS_SALARY: Optional[float] = None
    BANK_ACCOUNT_NUMBER: Optional[str] = None
    BANK_NAME: Optional[str] = None
    IFSC_CODE: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    AADHAAR_NUMBER: Optional[str] = None

    @field_validator(*_NULLABLE_STR_FIELDS, mode="before", check_fields=False)
    @classmethod
    def _empty_str_to_none(cls, v):

        if isinstance(v, str) and v.strip() == "":

            return None

        return v


class EmployeeUpdate(BaseModel):

    NAME: Optional[str] = None
    EMAIL: Optional[str] = None
    PHONE: Optional[str] = None
    DEPARTMENT_ID: Optional[int] = None
    DESIGNATION_ID: Optional[int] = None
    ROLE_ID: Optional[int] = None
    REPORTING_MANAGER_ID: Optional[str] = None
    SALARY: Optional[float] = None
    SHIFT_START: Optional[time] = None
    SHIFT_END: Optional[time] = None
    STATUS: Optional[str] = None
    SKILLS: Optional[str] = None

    # --- New profile / resume fields (all editable) ---
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    DOB: Optional[date] = None
    GENDER: Optional[str] = None
    FATHER_NAME: Optional[str] = None
    MOTHER_NAME: Optional[str] = None
    MARITAL_STATUS: Optional[str] = None
    OCCUPATION: Optional[str] = None
    QUALIFICATION: Optional[str] = None
    YEAR_OF_PASSING: Optional[int] = None
    EXPERIENCE_YEARS: Optional[float] = None
    EXPERIENCE_DETAILS: Optional[str] = None
    PAST_PROJECTS: Optional[str] = None
    EMPLOYMENT_TYPE: Optional[str] = None
    NOTES: Optional[str] = None

    # --- Phase A — HR Module expansion ---
    BLOOD_GROUP: Optional[str] = None
    NATIONALITY: Optional[str] = None
    EMERGENCY_CONTACT_NAME: Optional[str] = None
    EMERGENCY_CONTACT_PHONE: Optional[str] = None
    EMERGENCY_CONTACT_RELATION: Optional[str] = None
    CONFIRMATION_DATE: Optional[date] = None
    WORK_LOCATION: Optional[str] = None
    COLLEGE: Optional[str] = None
    UNIVERSITY: Optional[str] = None
    PERCENTAGE: Optional[float] = None
    PREVIOUS_COMPANY: Optional[str] = None
    PREVIOUS_SALARY: Optional[float] = None
    BANK_ACCOUNT_NUMBER: Optional[str] = None
    BANK_NAME: Optional[str] = None
    IFSC_CODE: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    AADHAAR_NUMBER: Optional[str] = None

    @field_validator(*_NULLABLE_STR_FIELDS, mode="before", check_fields=False)
    @classmethod
    def _empty_str_to_none(cls, v):

        if isinstance(v, str) and v.strip() == "":

            return None

        return v


class EmployeePasswordReset(BaseModel):

    NEW_PASSWORD: str
