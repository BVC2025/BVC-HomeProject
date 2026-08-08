"""Request / response models for the HRMS AI endpoints."""

from typing import List, Optional

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    """POST /hrms-ai/ask body."""

    message: str = Field(..., min_length=1, max_length=4000)
    session_id: str = Field(..., min_length=1, max_length=64)
    # Optional two-letter language hint (e.g. 'en', 'ta', 'hi'). If
    # omitted, Gemini auto-detects from the message text. Used to bias
    # the response into the user's preferred language even for short
    # 'yes' / 'ok' style follow-ups.
    language: Optional[str] = Field(None, max_length=8)


class SourceRef(BaseModel):
    """One knowledge-base chunk that grounded the answer."""

    module: str
    section: str
    score: float


class AskResponse(BaseModel):
    """POST /hrms-ai/ask response."""

    answer: str
    sources: List[SourceRef]
    grounded: bool                                # True = grounding check passed
    language: Optional[str] = None                # Detected language of the response


class HistoryMessage(BaseModel):
    role: str                                     # 'user' | 'assistant' | 'system'
    content: str
    created_at: Optional[str] = None


class HistoryResponse(BaseModel):
    session_id: str
    messages: List[HistoryMessage]


class RebuildResponse(BaseModel):
    ok: bool
    chunks: int
    took_ms: int
    doc_path: str
