"""Admin Module 5 — AI Command Center.

Single endpoint that takes a natural-language admin question and
returns a structured answer (text + table/number + follow-up
suggestions).

  POST /admin/ai/ask
       body: { "query": "show pending quotations" }
       returns: { intent, answer, data, suggestions, matched_via, query }
"""

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.services.ai_command_service import (
    answer_query,
    INTENT_PATTERNS,
    TOOL_NAME_TO_FN,
)


router = APIRouter(prefix="/admin/ai", tags=["AI Command Center"])


class AskBody(BaseModel):

    query: str


@router.post("/ask")
def ask(
    body: AskBody,
    db: Session = Depends(get_db),
):
    """Resolve a natural-language admin question against live ERP data.

    Resolution order:
      1. Keyword regex match → run the matched tool function
      2. If no match, ask Gemini which tool to use
      3. If Gemini is unavailable or undecided, return a help message
         with example queries.
    """

    return answer_query(db, body.query)


@router.get("/examples")
def example_queries():
    """Returns the curated set of suggested queries the UI shows as
    quick-pick chips on first load."""

    return {
        "categories": [
            {
                "label": "Sales & Quotations",
                "queries": [
                    "Show pending quotations",
                    "How much is monthly revenue?",
                    "Show pending payments",
                ],
            },
            {
                "label": "Projects & Production",
                "queries": [
                    "Which project is delayed?",
                    "Show production status",
                ],
            },
            {
                "label": "Inventory",
                "queries": [
                    "How much inventory is low stock?",
                ],
            },
            {
                "label": "HR & Attendance",
                "queries": [
                    "Who is absent today?",
                    "Who is present today?",
                    "Show pending leave requests",
                    "How many active employees?",
                ],
            },
            {
                "label": "Approvals",
                "queries": [
                    "Show pending approvals",
                    "How many customers do we have?",
                ],
            },
        ],
        "intent_count": len(TOOL_NAME_TO_FN),
        "keyword_pattern_count": len(INTENT_PATTERNS),
    }
