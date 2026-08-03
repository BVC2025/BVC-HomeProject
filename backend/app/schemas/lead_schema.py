from typing import Optional, Dict, Any
from pydantic import BaseModel


class LeadPollingConfigCreate(BaseModel):
    ACCOUNT_LABEL: str
    PLATFORM_NAME: str = "IndiaMART"
    BASE_URL: str = "https://mapi.indiamart.com/"
    ENDPOINT_URL: str = "wservce/crm/crmListing/v2/"
    PULL_API_KEY: str
    API_TYPE: str = "LAST_24_HOURS"
    API_DESCRIPTION: Optional[str] = None
    IS_ACTIVE: bool = False
    POLL_INTERVAL_MINUTES: int = 5


class LeadPollingConfigUpdate(BaseModel):
    ACCOUNT_LABEL: Optional[str] = None
    PLATFORM_NAME: Optional[str] = None
    BASE_URL: Optional[str] = None
    ENDPOINT_URL: Optional[str] = None
    PULL_API_KEY: Optional[str] = None  # None/blank = preserve existing key
    API_TYPE: Optional[str] = None
    API_DESCRIPTION: Optional[str] = None
    IS_ACTIVE: Optional[bool] = None
    POLL_INTERVAL_MINUTES: Optional[int] = None


class LivePreviewRequest(BaseModel):
    CONFIG_ID: str
    API_TYPE: str
    START_TIME: Optional[str] = None
    END_TIME: Optional[str] = None


class LeadCreate(BaseModel):
    CONTACT_NAME: str
    CONTACT_MOBILE: Optional[str] = None
    CONTACT_EMAIL: Optional[str] = None
    COMPANY_NAME: Optional[str] = None
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY_ISO: Optional[str] = None
    LEAD_MESSAGE: Optional[str] = None
    PRODUCT_INTEREST: Optional[str] = None
    ENQUIRY_TYPE: Optional[str] = None
    ENQUIRY_TIME: Optional[str] = None
    LEAD_STATUS: str = "NEW"
    ASSIGNED_TO_ID: Optional[str] = None
    CUSTOM_FIELDS: Optional[Dict[str, Any]] = None
    # LEAD_SOURCE / CREATED_BY_ID / EXTERNAL_REFERENCE_ID are server-controlled — not accepted here


class LeadUpdate(BaseModel):
    CONTACT_NAME: Optional[str] = None
    CONTACT_MOBILE: Optional[str] = None
    CONTACT_EMAIL: Optional[str] = None
    COMPANY_NAME: Optional[str] = None
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY_ISO: Optional[str] = None
    LEAD_MESSAGE: Optional[str] = None
    PRODUCT_INTEREST: Optional[str] = None
    ENQUIRY_TYPE: Optional[str] = None
    ENQUIRY_TIME: Optional[str] = None
    LEAD_STATUS: Optional[str] = None
    ASSIGNED_TO_ID: Optional[str] = None
    CUSTOM_FIELDS: Optional[Dict[str, Any]] = None
    # LEAD_SOURCE / EXTERNAL_REFERENCE_ID are immutable after creation — ignored if sent
