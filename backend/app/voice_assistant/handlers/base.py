"""Handler contract."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Employee
from app.voice_assistant.schemas import SessionState


@dataclass
class HandlerReply:
    reply:                 str
    conversation_complete: bool = False
    action_taken:          Optional[str] = None


class BaseHandler:

    intent: str = "unknown"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:
        raise NotImplementedError
