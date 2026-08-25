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
    ASSIGNED_TO_ID: Optional[str] = None
    PROJECT_ID: Optional[str] = None
    GST_NUMBER: Optional[str] = None
    CUSTOMER_ASSIGNMENT_TYPE: Optional[str] = None  # "NEW" | "EXISTING"; None = deferred to conversion time (legacy path)
    EXISTING_CUSTOMER_ID: Optional[str] = None      # required + validated only when CUSTOMER_ASSIGNMENT_TYPE == "EXISTING"
    CUSTOM_FIELDS: Optional[Dict[str, Any]] = None
    # LEAD_SOURCE / CREATED_BY_ID / EXTERNAL_REFERENCE_ID / LEAD_STATUS are
    # server-controlled — not accepted here. Every new lead always starts NEW.


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
    PROJECT_ID: Optional[str] = None
    GST_NUMBER: Optional[str] = None
    CUSTOMER_ASSIGNMENT_TYPE: Optional[str] = None  # "NEW" | "EXISTING" — rejected if the lead is already CONVERTED
    EXISTING_CUSTOMER_ID: Optional[str] = None
    CUSTOM_FIELDS: Optional[Dict[str, Any]] = None
    # LEAD_SOURCE / EXTERNAL_REFERENCE_ID are immutable after creation — ignored if sent
    # LEAD_STATUS == "CONVERTED" is rejected here — use POST .../leads/{id}/convert instead.


class LeadConvertRequest(BaseModel):
    """Body for POST /lead-management/leads/{lead_id}/convert. Every field is
    optional — the common case (customer assignment already decided at Lead
    creation time) posts {}. These fields are used ONLY as a fallback for a
    legacy lead with no CUSTOMER_ASSIGNMENT_TYPE recorded yet; when the lead
    already has one, every field below is ignored."""

    CUSTOMER_ASSIGNMENT_TYPE: Optional[str] = None   # "NEW" | "EXISTING"
    EXISTING_CUSTOMER_ID: Optional[str] = None        # required only if resolved type is EXISTING

    # New-customer field overrides/confirmations — each falls back to the
    # Lead's own contact/address columns when omitted. Named after the
    # Customer's own column names since these values feed straight into
    # Customer creation.
    NAME: Optional[str] = None
    COMPANY_NAME: Optional[str] = None
    PHONE_NUMBER: Optional[str] = None
    EMAIL: Optional[str] = None
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY_ISO: Optional[str] = None
    GST_NUMBER: Optional[str] = None

    # Customer Master's own Custom Fields — collected only now, at
    # conversion time, for the NEW path (never during Lead creation).
    CUSTOM_FIELDS: Optional[Dict[str, Any]] = None
