"""
chatbot_ai.py  —  HTTP entry-point for the Gemini-backed assistant.

Endpoint
--------
  POST /chatbot/ask
    Body: {
      message: str,                    # the user's input
      history: [{role, content}, ...], # optional, last few turns
      page_context: str                # optional, e.g. "/payroll"
    }
    Response: { reply: str, source: "gemini"|"fallback" }

The chatbot is admin AND employee facing — the prompt builder gates
data access by JWT role (see chatbot_ai_service).
"""

from typing import List, Optional, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_user
from app.services import chatbot_ai_service

router = APIRouter(prefix="/chatbot", tags=["Chatbot"])


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatAskBody(BaseModel):
    message:       str = Field(..., min_length=1, max_length=4000)
    history:       Optional[List[ChatTurn]] = None
    page_context:  Optional[str] = Field(None, max_length=120)


@router.post("/ask")
def chatbot_ask(
    body: ChatAskBody,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Send one user message to the AI; get one reply back.

    The endpoint is JWT-gated — the chatbot will never answer without
    knowing who's asking, so role-based access control can be enforced
    inside the prompt builder.
    """

    history_dicts = (
        [t.model_dump() for t in (body.history or [])][-12:]
        # cap history to last 12 turns so prompt size stays predictable
    )

    result = chatbot_ai_service.chat(
        db=db,
        user=payload,
        message=body.message,
        conversation_history=history_dicts,
        page_context=body.page_context,
    )

    return result
