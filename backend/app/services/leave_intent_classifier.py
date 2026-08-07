"""
Leave-agent intent classifier.

Pure rule-based today (no LLM dependency). Behind an interface so we
can drop in a Gemini / Claude / OpenAI classifier later without
touching the agent orchestrator.

Public surface:
    Intent          -- enum of supported intents
    IntentResult    -- intent + confidence + matched keywords
    classify(text)  -- returns IntentResult
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional
import re


class Intent(str, Enum):
    REQUEST  = "REQUEST"   # employee wants to apply for leave
    BALANCE  = "BALANCE"   # "how many leaves do I have?"
    STATUS   = "STATUS"    # "what's the status of my leave?"
    CANCEL   = "CANCEL"    # "cancel my leave"
    MODIFY   = "MODIFY"    # "extend my leave by 2 days"
    GREETING = "GREETING"  # "hi", "hello"
    CONFIRM  = "CONFIRM"   # "yes please", "go ahead"
    DENY     = "DENY"      # "no", "cancel"
    UNKNOWN  = "UNKNOWN"


@dataclass
class IntentResult:
    intent: Intent
    confidence: float                 # 0.0 -- 1.0
    matched_keywords: List[str]
    raw_text: str


# Keyword vocabularies — order matters: longer / more specific phrases
# first so they win over loose single-word matches.

_KEYWORDS = {
    Intent.CANCEL: [
        "cancel my leave", "withdraw my leave", "withdraw request",
        "cancel leave", "cancel request", "cancel my application",
        "delete my leave", "revoke leave",
    ],
    Intent.MODIFY: [
        "extend my leave", "change my leave", "modify leave",
        "shift my leave", "reschedule leave", "update leave",
        "extend leave by", "change dates",
    ],
    Intent.BALANCE: [
        "how many leaves", "leaves left", "leave balance",
        "leaves remaining", "leaves do i have", "leave remaining",
        "how much leave", "remaining leave",
    ],
    Intent.STATUS: [
        "leave status", "status of my leave", "is my leave approved",
        "my leave approved", "my leave rejected", "pending leave",
        "leave approval status",
    ],
    Intent.REQUEST: [
        "i need leave", "i want leave", "apply for leave",
        "apply leave", "take leave", "request leave",
        "book leave", "sick leave", "casual leave",
        "earned leave", "comp off", "maternity leave",
        "paternity leave", "i need a day off", "day off",
        "going on leave", "want to take", "need a leave",
        "i have a family function", "family function",
        "wedding", "marriage", "funeral", "doctor",
    ],
    Intent.GREETING: [
        "hello", "hi ", "hey", "good morning", "good afternoon",
        "good evening",
    ],
    Intent.CONFIRM: [
        "yes please", "yes go ahead", "go ahead", "please submit",
        "submit it", "confirm", "yes", "yep", "yeah",
        "sure", "ok", "okay",
    ],
    Intent.DENY: [
        "no thanks", "don't submit", "no", "nope",
        "cancel that", "stop",
    ],
}


# Words that, by themselves, are too ambiguous to trigger an intent —
# they have to appear with other context.
_AMBIGUOUS_SOLO = {"yes", "no", "ok", "okay", "sure"}


class IntentClassifier:
    """Abstract interface — swap implementations transparently."""

    def classify(self, text: str) -> IntentResult:  # pragma: no cover
        raise NotImplementedError


class RuleBasedIntentClassifier(IntentClassifier):
    """Keyword + simple heuristic classifier.

    Algorithm:
      1. Normalise the input (lowercase, strip punctuation).
      2. Test multi-word phrases first (longer phrases win).
      3. Resolve ambiguity: if the message is a single ambiguous word
         (e.g. just "yes"), require an upstream state to interpret it.
      4. Fall back to UNKNOWN with low confidence.
    """

    def classify(self, text: str) -> IntentResult:
        if not text:
            return IntentResult(Intent.UNKNOWN, 0.0, [], "")

        normalized = _normalize(text)

        best_intent: Optional[Intent] = None
        best_score = 0.0
        matched: List[str] = []

        # Score each intent by total length of matched keyword phrases.
        # Longer matches are stronger signals than short ones.
        for intent, vocab in _KEYWORDS.items():
            score, hits = _score_intent(normalized, vocab)
            if score > best_score:
                best_intent = intent
                best_score = score
                matched = hits

        if best_intent is None:
            return IntentResult(Intent.UNKNOWN, 0.0, [], text)

        # Solo-word guard: if the message is JUST an ambiguous word
        # like "yes" or "no", surface that as CONFIRM/DENY but flag
        # low confidence so the agent considers conversation state.
        stripped = normalized.strip()
        confidence = min(0.95, 0.5 + (best_score / max(len(normalized), 1)) * 0.6)
        if stripped in _AMBIGUOUS_SOLO:
            confidence = min(confidence, 0.6)

        return IntentResult(best_intent, confidence, matched, text)


# -------------------------------- helpers --------------------------

_PUNCT_RE = re.compile(r"[^\w\s'/-]")
_WS_RE    = re.compile(r"\s+")


def _normalize(text: str) -> str:
    t = text.lower().strip()
    t = _PUNCT_RE.sub(" ", t)
    t = _WS_RE.sub(" ", t)
    return t.strip()


def _score_intent(normalized: str, vocab: List[str]):
    hits: List[str] = []
    score = 0.0
    for phrase in vocab:
        if phrase in normalized:
            hits.append(phrase)
            score += len(phrase)   # longer phrase = stronger signal
    return score, hits


# Default instance — import this where you want a classifier.
default_classifier: IntentClassifier = RuleBasedIntentClassifier()
