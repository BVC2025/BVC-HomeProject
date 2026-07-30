from typing import Optional
from pydantic import BaseModel


class VendorWhatsAppConfigCreate(BaseModel):
    """The shared Meta WhatsApp Cloud API connection — one per vendor, reused
    by every ERP module. Per-module behavior (welcome templates, AI-reply
    toggle, ...) lives on WhatsAppModuleSetting instead — see
    WhatsAppModuleSettingCreate below."""
    ACCOUNT_LABEL: str
    BUSINESS_DISPLAY_NAME: Optional[str] = None
    BUSINESS_PHONE_NUMBER: Optional[str] = None

    PHONE_NUMBER_ID: str
    WABA_ID: str
    APP_ID: Optional[str] = None
    APP_SECRET: Optional[str] = None
    ACCESS_TOKEN: str
    TOKEN_EXPIRES_AT: Optional[str] = None

    VERIFY_TOKEN: str

    API_BASE_URL: str = "https://graph.facebook.com"
    GRAPH_API_VERSION: str = "v21.0"
    WEBHOOK_CALLBACK_URL: Optional[str] = None
    WEBHOOK_ENABLED: bool = False
    DEFAULT_COUNTRY_CODE: str = "91"
    DEFAULT_LANGUAGE: str = "en"

    MAX_SEND_PER_SECOND: int = 8
    DAILY_SEND_CAP: int = 900

    IS_ACTIVE: bool = False


class VendorWhatsAppConfigUpdate(BaseModel):
    ACCOUNT_LABEL: Optional[str] = None
    BUSINESS_DISPLAY_NAME: Optional[str] = None
    BUSINESS_PHONE_NUMBER: Optional[str] = None

    PHONE_NUMBER_ID: Optional[str] = None
    WABA_ID: Optional[str] = None
    APP_ID: Optional[str] = None
    APP_SECRET: Optional[str] = None    # blank/None = preserve existing secret
    ACCESS_TOKEN: Optional[str] = None  # blank/None = preserve existing token
    TOKEN_EXPIRES_AT: Optional[str] = None

    VERIFY_TOKEN: Optional[str] = None

    API_BASE_URL: Optional[str] = None
    GRAPH_API_VERSION: Optional[str] = None
    WEBHOOK_CALLBACK_URL: Optional[str] = None
    WEBHOOK_ENABLED: Optional[bool] = None
    DEFAULT_COUNTRY_CODE: Optional[str] = None
    DEFAULT_LANGUAGE: Optional[str] = None

    MAX_SEND_PER_SECOND: Optional[int] = None
    DAILY_SEND_CAP: Optional[int] = None

    IS_ACTIVE: Optional[bool] = None


class WhatsAppModuleSettingCreate(BaseModel):
    """Per-vendor, per-module WhatsApp automation behavior. MODULE_CODE
    identifies which ERP module this row belongs to (e.g. "lead_module")."""
    MODULE_CODE: str
    IS_ENABLED: bool = True
    AUTO_TRIGGER_ENABLED: bool = True

    WELCOME_TEMPLATE_NAME: Optional[str] = None
    WELCOME_TEMPLATE_LANG: str = "en_US"
    WELCOME_TEMPLATE_PARAMS: Optional[str] = None
    REENGAGE_TEMPLATE_NAME: Optional[str] = None
    REENGAGE_TEMPLATE_LANG: str = "en_US"

    AI_REPLY_ENABLED: bool = True
    SUPPORTED_LANGUAGES: str = "en"


class WhatsAppModuleSettingUpdate(BaseModel):
    IS_ENABLED: Optional[bool] = None
    AUTO_TRIGGER_ENABLED: Optional[bool] = None

    WELCOME_TEMPLATE_NAME: Optional[str] = None
    WELCOME_TEMPLATE_LANG: Optional[str] = None
    WELCOME_TEMPLATE_PARAMS: Optional[str] = None
    REENGAGE_TEMPLATE_NAME: Optional[str] = None
    REENGAGE_TEMPLATE_LANG: Optional[str] = None

    AI_REPLY_ENABLED: Optional[bool] = None
    SUPPORTED_LANGUAGES: Optional[str] = None


class WhatsAppTestSendRequest(BaseModel):
    TO_PHONE: str
    USE_TEMPLATE: bool = True
    MODULE_CODE: str = "lead_module"  # which module's welcome template to test with


class WhatsAppLinkLeadRequest(BaseModel):
    LEAD_ID: str


class WhatsAppAiToggleRequest(BaseModel):
    AI_ENABLED: bool


class WhatsAppManualSendRequest(BaseModel):
    BODY_TEXT: str
