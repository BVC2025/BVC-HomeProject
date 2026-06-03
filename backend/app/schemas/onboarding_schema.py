from datetime import date
from typing import Optional, Dict, Any, List

from pydantic import BaseModel


# ---------- Admin invite ----------

class OnboardingInviteCreate(BaseModel):
    """Admin generates an invitation link for a new customer."""

    NAME_HINT: Optional[str] = None
    EMAIL_HINT: Optional[str] = None
    INVITED_BY_ID: Optional[str] = None
    VENDOR_ID: int = 1


# ---------- Customer-portal account ----------

class PortalRegister(BaseModel):
    """Public — customer sets username + password on first visit."""

    USERNAME: str
    PASSWORD: str
    CONFIRM_PASSWORD: str


class PortalLogin(BaseModel):
    """Public — customer logs in to resume an in-progress session."""

    USERNAME: str
    PASSWORD: str


# ---------- Chat message ----------

class PortalChatMessage(BaseModel):
    """Authenticated portal — customer sends a chat message; AI
    replies with the next question / acknowledgement.

    If SKIP_FIELD is set, the backend treats this turn as a
    deterministic skip: it marks that field key as skipped in the
    session's persisted skip list and advances to the next field
    WITHOUT consulting the AI. This guarantees the same question
    can never be re-asked even if Gemini misbehaves.
    """

    MESSAGE: str
    SKIP_FIELD: Optional[str] = None


# ---------- Admin views ----------

class OnboardingSessionListItem(BaseModel):
    """Slim row used by the admin's pending-invitations list."""

    ID: int
    TOKEN: str
    STATUS: str
    NAME_HINT: Optional[str] = None
    EMAIL_HINT: Optional[str] = None
    PROGRESS_PCT: int = 0
    CREATED_AT: Optional[str] = None
    LAST_ACTIVITY_AT: Optional[str] = None
    SUBMITTED_AT: Optional[str] = None
    CUSTOMER_ID: Optional[int] = None


# ---------- Final submission ----------

class OnboardingSubmit(BaseModel):
    """No body needed — the server uses session.PARTIAL_DATA. The
    schema exists so the endpoint can be called with an empty POST."""

    CONFIRMED: bool = True
