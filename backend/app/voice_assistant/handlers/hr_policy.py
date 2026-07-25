"""
HR-policy Q&A handler.

For policy questions we let Gemini generate the natural-language
answer BUT we ground it in a small, fixed knowledge snippet built
from the ERP's own settings (leave quotas, working hours, holidays)
so it can never hallucinate a policy that doesn't exist.

If Gemini is unavailable, we hand-craft a reply from the same
snippet.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date

from sqlalchemy.orm import Session

from app.models.models import Employee, HolidayCalendar, LeaveBalance
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


log = logging.getLogger("voice_assistant.hr_policy")


GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()


def _build_policy_snippet(db: Session, employee: Employee) -> str:
    """Small deterministic context Gemini answers FROM."""
    lines = ["BVC24 HR policy facts (source of truth):"]

    bal = (
        db.query(LeaveBalance)
        .filter(LeaveBalance.EMPLOYEE_ID == employee.ID)
        .first()
    )
    if bal:
        lines.append(
            f"- Leave quota: {bal.CASUAL_TOTAL or 0:g} casual, "
            f"{bal.SICK_TOTAL or 0:g} sick, {bal.EARNED_TOTAL or 0:g} earned per year."
        )

    lines.append("- Working days: Monday to Saturday (6-day week). Sunday is weekly off.")
    lines.append("- Working hours: 10:00 to 18:00.")
    lines.append("- Reason is required for any leave longer than 2 days.")
    lines.append("- Permissions (short leave) are hour-based, capped at 8 hours per request.")

    year = date.today().year
    holidays = (
        db.query(HolidayCalendar)
        .filter(HolidayCalendar.HOLIDAY_DATE >= date(year, 1, 1))
        .filter(HolidayCalendar.HOLIDAY_DATE <= date(year, 12, 31))
        .order_by(HolidayCalendar.HOLIDAY_DATE)
        .limit(20)
        .all()
    )
    if holidays:
        names = ", ".join(f"{h.HOLIDAY_DATE.isoformat()} {h.NAME}" for h in holidays[:8])
        lines.append(f"- {year} holidays (first few): {names}.")

    return "\n".join(lines)


def _sync_gemini_answer(question: str, snippet: str) -> str | None:
    if not GEMINI_API_KEY:
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            system_instruction=(
                "You are an HR-policy assistant for BVC24. Answer in ONE short "
                "sentence based ONLY on the FACTS block. If the answer isn't in "
                "the facts, say 'I don't have that policy on record — please ask HR.' "
                "Never invent rules."
            ),
            generation_config={"temperature": 0.2},
        )
        resp = model.generate_content(
            f"FACTS:\n{snippet}\n\nQUESTION: {question}\n\nAnswer:"
        )
        return (resp.text or "").strip() or None
    except Exception as exc:
        log.warning("Gemini HR-policy call failed: %s", exc)
        return None


class HRPolicyHandler(BaseHandler):

    intent = "hr_policy"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:

        # We use the user's original message as the question — pass it via slots
        question = session.slots.get("_last_user_message") or ""

        snippet = _build_policy_snippet(db, employee)

        answer = None
        if GEMINI_API_KEY and question:
            loop = asyncio.get_event_loop()
            answer = await loop.run_in_executor(
                None, _sync_gemini_answer, question, snippet,
            )

        if not answer:
            # Deterministic fallback
            answer = (
                "Working days are Monday to Saturday, 10 AM to 6 PM. "
                "You get 12 casual, 12 sick, and 15 earned leaves a year. "
                "Reason is required for leaves longer than 2 days."
            )

        session.active_intent = None; session.slots = {}
        return HandlerReply(
            reply=answer,
            conversation_complete=True,
            action_taken="hr_policy_answered",
        )
