from datetime import date
from typing import Optional, Dict, Any
from pydantic import BaseModel


class ProjectQuotationUpdate(BaseModel):
    QUOTATION_NUMBER: Optional[str] = None
    QUOTATION_DATE: Optional[date] = None
    CONTENT_JSON: Optional[Dict[str, Any]] = None
    # Opaque, frontend-owned section-tree shape — no rigid sub-modeling,
    # matching how EmailTemplate.DESIGN_JSON is handled as opaque JSON.
