"""
AI Negotiation Assistant for the public quotation page.

This service powers the chat widget that customers see when they
open their `/q/{token}` quotation link. It uses Google Gemini to
parse the customer's natural-language request (price reduction,
extended warranty, faster delivery, installation help, etc.) and
returns a strict JSON structure the route layer can act on.

Design goals
------------
- Single Gemini call per turn (response_mime_type=application/json)
- Walk the GEMINI_MODEL_FALLBACKS chain on quota / 429 errors so a
  single throttled model doesn't kill the conversation
- Always return a safe deterministic fallback when Gemini itself
  is unreachable (key missing, no network, all models exhausted).
  The bot never crashes — worst case it says "I'll have our sales
  team reach out shortly to discuss this."
- The route layer MUST clamp the discount before persisting (this
  module is advisory; trust boundary lives in the route).
"""

import json
import os
import re
from typing import Any, Dict, List, Optional

# Reuse the same fallback chain the rest of the platform uses so
# behaviour stays consistent across all AI features.
try:
    from app.services.gemini_service import (
        GEMINI_API_KEY,
        GEMINI_MODEL_FALLBACKS,
        is_gemini_configured,
    )
except Exception:  # pragma: no cover — defensive import
    GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
    GEMINI_MODEL_FALLBACKS = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-flash-latest",
    ]

    def is_gemini_configured() -> bool:
        return bool(GEMINI_API_KEY)


# ----------------------------------------------------------------
# Public output schema
# ----------------------------------------------------------------
#
# The negotiate() function always returns a dict with at minimum:
#   {
#     "reply": str,                # human-facing chat message
#     "intent": str,               # DISCOUNT|WARRANTY|INSTALL|DELIVERY|QUANTITY|INFO|OTHER
#     "action": str,               # AUTO_APPROVE|COUNTER|DECLINE|INFO_ONLY
#     "discount_percent": float,   # 0 if not applicable
#     "counter_text": str          # short summary of the counter (may be "")
#   }
# Routes consume this dict, clamp the discount, persist activity
# rows and return the public-safe payload to the customer.


VALID_INTENTS = {"DISCOUNT", "WARRANTY", "INSTALL", "DELIVERY",
                 "QUANTITY", "INFO", "OTHER"}

VALID_ACTIONS = {"AUTO_APPROVE", "COUNTER", "DECLINE", "INFO_ONLY"}


def _safe_fallback(message: Optional[str] = None) -> Dict[str, Any]:
    """Deterministic safe reply used when Gemini is down or the
    response can't be parsed. We never throw to the route — chats
    must keep working even when AI is offline."""

    return {
        "reply": (
            message
            or "Thank you for your message. I'll have our sales team "
               "reach out shortly to discuss this in more detail."
        ),
        "intent": "OTHER",
        "action": "INFO_ONLY",
        "discount_percent": 0.0,
        "counter_text": ""
    }


def _is_quota_error(exc: Exception) -> bool:
    """Mirror onboarding_ai_service heuristic for quota errors."""

    msg = str(exc).lower()

    return (
        "429" in msg
        or "quota" in msg
        or "rate" in msg
        or "exhaust" in msg
    )


def _safe_parse_json(text: str) -> Optional[Dict[str, Any]]:
    """Try hard to parse a Gemini JSON response — strip code-fences
    and trailing prose if the model went off-script."""

    if not text:

        return None

    raw = text.strip()

    # Strip ```json ... ``` fences if present
    if raw.startswith("```"):

        raw = re.sub(r"^```(?:json)?", "", raw).strip()

        if raw.endswith("```"):

            raw = raw[:-3].strip()

    try:

        return json.loads(raw)

    except Exception:

        pass

    # Last resort: pull out the first { ... } block we can find
    m = re.search(r"\{[\s\S]*\}", raw)

    if not m:

        return None

    try:

        return json.loads(m.group(0))

    except Exception:

        return None


def _coerce_float(val: Any, default: float = 0.0) -> float:
    """Best-effort float cast — handles numbers, numeric strings and
    values with stray % signs ('15%')."""

    if val is None:

        return default

    if isinstance(val, (int, float)):

        return float(val)

    try:

        cleaned = re.sub(r"[^\d\.\-]", "", str(val))

        return float(cleaned) if cleaned else default

    except Exception:

        return default


def _build_system_prompt(
    quotation,
    customer,
    max_discount_percent: float
) -> str:
    """The personality + policy rulebook for the assistant. Gemini
    is locked to JSON output (response_mime_type) so it cannot
    speak outside the schema."""

    customer_name = (
        getattr(customer, "CUSTOMER_NAME", None)
        or "valued customer"
    )

    qno = getattr(quotation, "QUOTATION_NUMBER", "—")

    grand_total = float(getattr(quotation, "GRAND_TOTAL", 0) or 0)

    current_discount = float(getattr(quotation, "DISCOUNT_PERCENT", 0) or 0)

    expiry = getattr(quotation, "EXPIRY_DATE", None)

    expiry_str = expiry.isoformat() if expiry else "—"

    counter_cap = round(max_discount_percent * 1.5, 2)

    return f"""
You are the BVC24 Negotiation Assistant, chatting with a customer on
their open quotation page. You are warm, professional, and speak in
clear Indian English. You represent Bharath Vending Corporation
(Coimbatore, India).

The customer is: {customer_name}
The open quotation is: {qno}
Current grand total: INR {grand_total:,.2f}
Current quotation-level discount already applied: {current_discount}%
Quotation valid until: {expiry_str}

POLICY RULES (binding — never break these):

1. Maximum auto-approvable discount: {max_discount_percent}%
   - If the customer asks for a discount <= {max_discount_percent}%
     -> action="AUTO_APPROVE", discount_percent = requested amount,
        intent="DISCOUNT". Be warm in your reply.
   - If the customer asks for more than {max_discount_percent}% but
     <= {counter_cap}% (within 1.5x the cap)
     -> action="COUNTER", discount_percent = {max_discount_percent},
        intent="DISCOUNT". Politely offer the max allowed.
   - If the customer asks for more than {counter_cap}%
     -> action="DECLINE", discount_percent = 0,
        intent="DISCOUNT". Politely explain you can't go that
        deep and offer to have the sales team call them.

2. Warranty extension:
   - Up to 6 extra months free -> action="AUTO_APPROVE",
     intent="WARRANTY", discount_percent = 0.
   - Beyond 6 months -> action="COUNTER", intent="WARRANTY",
     discount_percent = 0, mention a paid extension is possible
     and the sales team will share the cost.

3. Installation:
   - action="AUTO_APPROVE", intent="INSTALL", discount_percent = 0.
   - Installation is already included in standard terms — reassure
     the customer.

4. Delivery expedite:
   - action="COUNTER", intent="DELIVERY", discount_percent = 0.
   - Explain expedited delivery may attract a surcharge and the
     sales team will confirm options.

5. Quantity changes (add or reduce units):
   - action="INFO_ONLY", intent="QUANTITY", discount_percent = 0.
   - Reply confirming the team will revise the quote.

6. Plain questions ("when can you deliver?", "what is the warranty?"):
   - action="INFO_ONLY", intent="INFO", discount_percent = 0.
   - Answer briefly with what you can infer from the quotation
     context above.

7. Anything else / unclear:
   - action="INFO_ONLY", intent="OTHER", discount_percent = 0.
   - Acknowledge and say sales will follow up.

OUTPUT FORMAT (STRICT JSON, no markdown, no prose around it):
{{
  "reply": "<conversational message to customer>",
  "intent": "DISCOUNT|WARRANTY|INSTALL|DELIVERY|QUANTITY|INFO|OTHER",
  "action": "AUTO_APPROVE|COUNTER|DECLINE|INFO_ONLY",
  "discount_percent": <number, 0 if not a discount action>,
  "counter_text": "<short human description of the counter-offer; empty string if none>"
}}

NEVER quote a discount higher than {max_discount_percent}% — even
in COUNTER mode. The server clamps the value anyway, but please
respect the policy in your reply too.
""".strip()


def _build_history(history: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Convert our QuotationNegotiation rows into the format
    google-generativeai expects for chat history."""

    out: List[Dict[str, Any]] = []

    if not history:

        return out

    for h in history[-12:]:  # cap context to last 12 turns

        role = (h.get("ROLE") or h.get("role") or "").lower()

        content = h.get("CONTENT") or h.get("content") or ""

        if not content:

            continue

        if role == "customer" or role == "user":

            out.append({"role": "user", "parts": [content]})

        elif role == "assistant" or role == "model":

            out.append({"role": "model", "parts": [content]})

    return out


def _call_gemini(
    system_prompt: str,
    gemini_history: List[Dict[str, Any]],
    user_message: str
) -> Optional[Dict[str, Any]]:
    """Run the Gemini fallback chain. Returns parsed dict or None
    on total failure. Never raises."""

    if not is_gemini_configured():

        return None

    try:

        import google.generativeai as genai

    except Exception:

        return None

    try:

        genai.configure(api_key=GEMINI_API_KEY)

    except Exception:

        return None

    last_exc: Optional[Exception] = None

    for model_name in GEMINI_MODEL_FALLBACKS:

        try:

            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_prompt,
                generation_config={"response_mime_type": "application/json"}
            )

            chat = model.start_chat(history=gemini_history)

            response = chat.send_message(user_message)

            try:

                text = response.text or ""

            except Exception:

                # Some SDK versions hide text behind candidates[]
                text = ""

                for cand in getattr(response, "candidates", []) or []:

                    for part in getattr(cand.content, "parts", []) or []:

                        text += getattr(part, "text", "") or ""

            parsed = _safe_parse_json(text)

            if parsed:

                return parsed

            # If Gemini returned non-JSON despite the mime hint,
            # try the next model — it's a soft failure.
            continue

        except Exception as exc:

            last_exc = exc

            if _is_quota_error(exc):

                continue

            # Hard error (network, auth) — bail and let the safe
            # fallback take over.
            return None

    return None


def _normalize(parsed: Dict[str, Any], max_discount_percent: float) -> Dict[str, Any]:
    """Validate Gemini's response, coerce types, clamp dangerous
    values. The route layer also clamps before persisting — this is
    belt-and-suspenders."""

    reply = str(parsed.get("reply") or "").strip()

    if not reply:

        reply = (
            "Thanks for reaching out — our team will get back to "
            "you with details shortly."
        )

    intent = str(parsed.get("intent") or "OTHER").strip().upper()

    if intent not in VALID_INTENTS:

        intent = "OTHER"

    action = str(parsed.get("action") or "INFO_ONLY").strip().upper()

    if action not in VALID_ACTIONS:

        action = "INFO_ONLY"

    discount_percent = _coerce_float(parsed.get("discount_percent"), 0.0)

    # Clamp for safety. Server-side clamp in the route is the
    # authoritative one, but this prevents a runaway reply from
    # ever advertising more than policy allows.
    if discount_percent < 0:

        discount_percent = 0.0

    if discount_percent > max_discount_percent:

        discount_percent = max_discount_percent

    if intent != "DISCOUNT":

        # Only discount actions carry a numeric offer
        discount_percent = 0.0

    counter_text = str(parsed.get("counter_text") or "").strip()

    return {
        "reply": reply,
        "intent": intent,
        "action": action,
        "discount_percent": round(discount_percent, 2),
        "counter_text": counter_text
    }


def negotiate(
    db,
    quotation,
    customer,
    message: str,
    history: Optional[List[Dict[str, Any]]] = None,
    max_discount_percent: float = 10.0
) -> Dict[str, Any]:
    """Main entry point. Always returns a usable dict — never
    raises. `db` is accepted for parity with other AI services but
    not used directly (no DB writes here; that's the route's job)."""

    msg = (message or "").strip()

    if not msg:

        return _safe_fallback(
            "Please type your question or request and I'll be happy "
            "to help."
        )

    system_prompt = _build_system_prompt(
        quotation, customer, max_discount_percent
    )

    gemini_history = _build_history(history)

    parsed = _call_gemini(system_prompt, gemini_history, msg)

    if not parsed or not isinstance(parsed, dict):

        return _safe_fallback()

    return _normalize(parsed, max_discount_percent)
