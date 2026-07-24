"""
Customer self-onboarding chatbot — Gemini-driven extractor with
smart widget hints.

Each FIELD entry carries:
  - key            backend column name
  - label          friendly display name (used in Pending list)
  - question       fallback question text (rule-based bot uses this)
  - required       whether it's mandatory for a "complete" profile
  - group          identity / reach / location / tax / order / pipeline
  - widget         text | select | radio | cards | date | number | textarea
  - options        list of {label, value, [emoji]} when widget is
                   select/radio/cards

The chat endpoint surfaces `widget` + `options` for the next field so
the portal UI can render the right control instead of a plain
text input.
"""

import json
import os
import re
from typing import Optional, Dict, Any, List, Tuple


# ----------------------------------------------------------------
# Field catalogue
# ----------------------------------------------------------------

def _opt(label, value=None, emoji=None):
    """Build an option dict. value defaults to label."""

    o = {"label": label, "value": value if value is not None else label}

    if emoji:

        o["emoji"] = emoji

    return o


FIELDS: List[dict] = [
    # ---------- Identity ----------
    {
        "key": "CUSTOMER_NAME",
        "label": "Company name",
        "question": "What is your company or organization name?",
        "required": True,
        "group": "identity",
        "widget": "text"
    },
    {
        "key": "CUSTOMER_TYPE",
        "label": "Customer type",
        "question": "What type of company is it?",
        "required": False,
        "group": "identity",
        "widget": "select",
        "options": [
            _opt("Private Limited Company"),
            _opt("Public Limited Company"),
            _opt("LLP"),
            _opt("Partnership"),
            _opt("Proprietorship"),
            _opt("Government Organization"),
            _opt("Other"),
        ],
    },
    {
        "key": "BUSINESS_TYPE",
        "label": "Business sector",
        "question": "What kind of business sector are you in?",
        "required": True,
        "group": "identity",
        "widget": "cards",
        "options": [
            _opt("Hospital",      emoji="🏥"),
            _opt("Corporate Office", emoji="🏢"),
            _opt("Hotel",         emoji="🏨"),
            _opt("School/College",emoji="🎓"),
            _opt("Factory",       emoji="🏭"),
            _opt("Mall/Retail",   emoji="🛍️"),
            _opt("Airport/Transit", emoji="✈️"),
            _opt("Other",         emoji="📦"),
        ],
    },
    {
        "key": "INDUSTRY",
        "label": "Industry",
        "question": "Which industry best describes your business?",
        "required": True,
        "group": "identity",
        "widget": "text"
    },
    {
        "key": "CONTACT_PERSON",
        "label": "Primary contact name",
        "question": "Who is the primary contact person for this account?",
        "required": True,
        "group": "identity",
        "widget": "text"
    },
    {
        "key": "DESIGNATION",
        "label": "Designation",
        "question": "What is their designation / role?",
        "required": False,
        "group": "identity",
        "widget": "text"
    },
    {
        "key": "NUMBER_OF_BRANCHES",
        "label": "Number of branches",
        "question": "How many branches or locations does your company have?",
        "required": False,
        "group": "identity",
        "widget": "number"
    },
    {
        "key": "EXPECTED_MONTHLY_ORDERS",
        "label": "Expected monthly orders",
        "question": "Roughly how many machines do you expect to order per month?",
        "required": False,
        "group": "identity",
        "widget": "number"
    },
    {
        "key": "EXISTING_MACHINE_USAGE",
        "label": "Already using vending machines",
        "question": "Are you currently using any vending machines from another vendor?",
        "required": False,
        "group": "identity",
        "widget": "radio",
        "options": [_opt("Yes", value=1), _opt("No", value=0)],
    },
    {
        "key": "CURRENT_VENDOR_NAME",
        "label": "Current vending vendor",
        "question": "Who is your current vending machine vendor?",
        "required": False,
        "group": "identity",
        "widget": "text",
    },

    # ---------- Reach ----------
    {
        "key": "PHONE",
        "label": "Phone",
        "question": "What is the primary mobile / phone number?",
        "required": True,
        "group": "reach",
        "widget": "text"
    },
    {
        "key": "ALTERNATE_PHONE",
        "label": "Alternate phone",
        "question": "Any alternate phone number we can reach you at?",
        "required": False,
        "group": "reach",
        "widget": "text"
    },
    {
        "key": "EMAIL",
        "label": "Email",
        "question": "What is your business email address?",
        "required": True,
        "group": "reach",
        "widget": "text"
    },
    {
        "key": "WHATSAPP_NUMBER",
        "label": "WhatsApp",
        "question": "What is your WhatsApp number? (Use same as phone if applicable)",
        "required": False,
        "group": "reach",
        "widget": "text"
    },
    {
        "key": "WEBSITE",
        "label": "Website",
        "question": "Your company website?",
        "required": False,
        "group": "reach",
        "widget": "text"
    },

    # ---------- Location ----------
    {
        "key": "ADDRESS",
        "label": "Office address",
        "question": "What is your office address?",
        "required": True,
        "group": "location",
        "widget": "textarea"
    },
    {
        "key": "CITY",
        "label": "City",
        "question": "Which city?",
        "required": True,
        "group": "location",
        "widget": "text"
    },
    {
        "key": "STATE",
        "label": "State",
        "question": "Which state?",
        "required": True,
        "group": "location",
        "widget": "text"
    },
    {
        "key": "PINCODE",
        "label": "Pincode",
        "question": "Pincode?",
        "required": True,
        "group": "location",
        "widget": "number"
    },
    {
        "key": "COUNTRY",
        "label": "Country",
        "question": "Country?",
        "required": False,
        "group": "location",
        "widget": "text"
    },
    {
        "key": "BILLING_ADDRESS",
        "label": "Billing address",
        "question": "Where should we send invoices? (skip if same as office)",
        "required": False,
        "group": "location",
        "widget": "textarea"
    },
    {
        "key": "SHIPPING_ADDRESS",
        "label": "Installation / shipping address",
        "question": "Where should the vending machines be installed? (skip if same as office)",
        "required": False,
        "group": "location",
        "widget": "textarea"
    },

    # ---------- Tax ----------
    {
        "key": "GST_NUMBER",
        "label": "GST number",
        "question": "What is your GST registration number?",
        "required": False,
        "group": "tax",
        "widget": "text"
    },
    {
        "key": "PAN_NUMBER",
        "label": "PAN number",
        "question": "PAN number?",
        "required": False,
        "group": "tax",
        "widget": "text"
    },

    # ---------- Pipeline ----------
    {
        "key": "LEAD_SOURCE",
        "label": "How did you hear about us",
        "question": "How did you hear about BVC24?",
        "required": False,
        "group": "pipeline",
        "widget": "select",
        "options": [
            _opt("Website"),
            _opt("Sales Team"),
            _opt("Referral"),
            _opt("Trade Show"),
            _opt("WhatsApp"),
            _opt("Email"),
            _opt("Other"),
        ],
    },
    {
        "key": "LEAD_PRIORITY",
        "label": "Priority",
        "question": "How urgent is your requirement?",
        "required": False,
        "group": "pipeline",
        "widget": "cards",
        "options": [
            _opt("High",   emoji="🔥"),
            _opt("Medium", emoji="⚡"),
            _opt("Low",    emoji="🌱"),
        ],
    },
    {
        "key": "FOLLOW_UP_DATE",
        "label": "Preferred follow-up date",
        "question": "When would you like our team to follow up?",
        "required": False,
        "group": "pipeline",
        "widget": "date"
    },

    # ---------- Order intake ----------
    {
        "key": "REQUESTED_MACHINE_CATEGORY",
        "label": "Machine category",
        "question": "Which category of vending machine are you interested in?",
        "required": True,
        "group": "order",
        "widget": "cards",
        "options": [
            _opt("Snack Machine",       emoji="🍫"),
            _opt("Beverage Machine",    emoji="☕"),
            _opt("Combo Machine",       emoji="🥤"),
            _opt("Medicine Machine",    emoji="💊"),
            _opt("Fruit & Veg Machine", emoji="🍎"),
            _opt("Cosmetics Machine",   emoji="🧴"),
            _opt("Custom Machine",      emoji="🛠️"),
        ],
    },
    {
        "key": "REQUESTED_MACHINE_NAME",
        "label": "Machine model wanted",
        "question": "Do you have a specific model name in mind? (otherwise describe what you want)",
        "required": True,
        "group": "order",
        "widget": "text"
    },
    {
        "key": "REQUESTED_QUANTITY",
        "label": "Quantity",
        "question": "How many machines do you require?",
        "required": True,
        "group": "order",
        "widget": "number"
    },
    {
        "key": "REQUIREMENT_NOTES",
        "label": "Special requirements",
        "question": "Any special requirements, installation needs, or features we should know about?",
        "required": False,
        "group": "order",
        "widget": "textarea"
    },
]


# ----------------------------------------------------------------
# Field helpers
# ----------------------------------------------------------------

# ----------------------------------------------------------------
# Per-field maximum length — matches the Customer model columns.
# Used by safe_truncate() at submit time AND by validators here so
# the DB never sees a value too large for its column.
# ----------------------------------------------------------------
MAX_LENGTHS = {
    "CUSTOMER_NAME":      100,
    "CONTACT_PERSON":     100,
    "DESIGNATION":         80,
    "PHONE":               20,
    "ALTERNATE_PHONE":     20,
    "EMAIL":              100,
    "WEBSITE":            150,
    "ADDRESS":            500,
    "CITY":               100,
    "STATE":              100,
    "PINCODE":             15,
    "COUNTRY":             60,
    "GST_NUMBER":          20,   # standard 15; column allows 20
    "PAN_NUMBER":          15,   # standard 10; column allows 15
    "INDUSTRY":            80,
    "CUSTOMER_TYPE":       30,
    "BUSINESS_TYPE":       60,
    "CURRENT_VENDOR_NAME":150,
    "WHATSAPP_NUMBER":     20,
    "BILLING_ADDRESS":    500,
    "SHIPPING_ADDRESS":   500,
    "GOOGLE_MAP_LOCATION":255,
    "LEAD_SOURCE":         40,
    "LEAD_PRIORITY":       10,
    "REQUIREMENT_NOTES": 2000,
    "REQUESTED_MACHINE_NAME":     150,
    "REQUESTED_MACHINE_CATEGORY":  60,
}


# Reserved key inside PARTIAL_DATA — stores the list of field keys
# the customer chose to skip. Skipped fields are NOT asked again by
# the question loop but still appear in the Pending Information
# panel (with a "Skipped" hint) so the customer can revisit later.
SKIPPED_KEY = "__skipped__"


def field_meta(key: str) -> Optional[dict]:

    for f in FIELDS:

        if f["key"] == key:

            return f

    return None


def required_keys() -> List[str]:

    return [f["key"] for f in FIELDS if f["required"]]


def all_keys() -> List[str]:

    return [f["key"] for f in FIELDS]


def skipped_keys(partial: Dict[str, Any]) -> List[str]:

    val = (partial or {}).get(SKIPPED_KEY) or []

    if isinstance(val, list):

        return [str(k) for k in val if k]

    return []


def mark_skipped(partial: Dict[str, Any], key: str) -> None:
    """Add `key` to the persisted skipped list in-place."""

    if not key:

        return

    skip = skipped_keys(partial)

    if key not in skip:

        skip.append(key)

    partial[SKIPPED_KEY] = skip


def is_skipped(partial: Dict[str, Any], key: str) -> bool:

    return key in skipped_keys(partial)


def compute_progress(partial: Dict[str, Any]) -> int:
    """Total fields, all weighted equally. 100% only when every
    field in the catalogue is genuinely filled (skipped doesn't
    count as filled — the customer chose to leave it blank)."""

    if not FIELDS:

        return 0

    filled = sum(
        1 for f in FIELDS
        if partial.get(f["key"]) not in (None, "", 0)
    )

    return int(round(filled / len(FIELDS) * 100))


def missing_required(partial: Dict[str, Any]) -> List[str]:

    return [
        k for k in required_keys()
        if partial.get(k) in (None, "", 0)
    ]


def pending_fields(partial: Dict[str, Any]) -> List[dict]:
    """Return the list of unfilled fields with friendly labels.
    Required first, then optional, then skipped at the bottom."""

    skips = set(skipped_keys(partial))

    pending = []

    # Required first (only those not yet filled and not skipped)
    for f in FIELDS:

        if (
            f["required"]
            and partial.get(f["key"]) in (None, "", 0)
            and f["key"] not in skips
        ):

            pending.append({
                "key": f["key"],
                "label": f["label"],
                "required": True,
                "group": f["group"],
                "skipped": False
            })

    # Optional unfilled (not skipped)
    for f in FIELDS:

        if (
            not f["required"]
            and partial.get(f["key"]) in (None, "", 0)
            and f["key"] not in skips
        ):

            pending.append({
                "key": f["key"],
                "label": f["label"],
                "required": False,
                "group": f["group"],
                "skipped": False
            })

    # Skipped fields at the bottom — still surfaced so the customer
    # can come back and fill them.
    for f in FIELDS:

        if f["key"] in skips and partial.get(f["key"]) in (None, "", 0):

            pending.append({
                "key": f["key"],
                "label": f["label"],
                "required": f["required"],
                "group": f["group"],
                "skipped": True
            })

    return pending


def first_unfilled_field(partial: Dict[str, Any]) -> Optional[dict]:
    """Return the first unfilled, non-skipped field in catalogue
    order. Required prioritised over optional."""

    skips = set(skipped_keys(partial))

    for f in FIELDS:

        if (
            f["required"]
            and partial.get(f["key"]) in (None, "", 0)
            and f["key"] not in skips
        ):

            return f

    for f in FIELDS:

        if (
            not f["required"]
            and partial.get(f["key"]) in (None, "", 0)
            and f["key"] not in skips
        ):

            return f

    return None


def safe_truncate(partial: Dict[str, Any]) -> Dict[str, Any]:
    """Apply MAX_LENGTHS to every string value in `partial`. Strips
    the reserved __skipped__ key too. Returns a NEW dict — the
    original is not mutated. Call this before inserting into the
    Customer table so column-overflow IntegrityErrors never fire."""

    out = {}

    for k, v in (partial or {}).items():

        if k == SKIPPED_KEY:

            continue

        if isinstance(v, str):

            limit = MAX_LENGTHS.get(k)

            if limit and len(v) > limit:

                out[k] = v[:limit]

                continue

        out[k] = v

    return out


def widget_for(field_key: Optional[str]) -> dict:
    """Return {widget, options} for the named field, or a plain-text
    default if the key isn't known."""

    if not field_key:

        return {"widget": "text", "options": []}

    f = field_meta(field_key)

    if not f:

        return {"widget": "text", "options": []}

    return {
        "widget": f.get("widget", "text"),
        "options": f.get("options", []),
        "label": f.get("label"),
        "field_key": f["key"]
    }


# ----------------------------------------------------------------
# Gemini configuration
#
# Free-tier quotas (per-day, per-key as of late 2025):
#   gemini-2.5-flash       — 250 req/day, 10 RPM  (tight)
#   gemini-2.5-flash-lite  — 1,000 req/day, 15 RPM
#   gemini-2.0-flash       — 1,500 req/day, 15 RPM (best free tier)
#   gemini-flash-latest    — Google's rolling alias
#
# We build a fallback chain so a 429 on one model transparently
# tries the next, keeping the conversation alive without surfacing
# any technical error to the customer.
# ----------------------------------------------------------------

GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()

GEMINI_MODEL_FALLBACKS = [
    "gemini-2.0-flash",      # Best free quota — primary
    "gemini-2.5-flash-lite", # Decent quota
    "gemini-flash-latest",   # Rolling alias
    "gemini-2.5-flash",      # Tight quota — last resort
]

_user_model = (os.getenv("GEMINI_MODEL") or "").strip()

if _user_model:

    # User's explicit choice goes first, others stay as fallbacks
    GEMINI_MODEL_FALLBACKS = (
        [_user_model]
        + [m for m in GEMINI_MODEL_FALLBACKS if m != _user_model]
    )

GEMINI_MODEL = GEMINI_MODEL_FALLBACKS[0]


def is_gemini_configured() -> bool:

    return bool(GEMINI_API_KEY)


def _build_system_prompt(partial: Dict[str, Any]) -> str:

    catalog_lines = []

    for f in FIELDS:

        tag = "REQUIRED" if f["required"] else "optional"

        opts = ""

        if f.get("options"):

            opt_labels = [o["label"] for o in f["options"]]

            opts = f" (options: {', '.join(opt_labels)})"

        max_hint = ""

        if f["key"] in MAX_LENGTHS:

            max_hint = f" max_chars={MAX_LENGTHS[f['key']]}"

        catalog_lines.append(
            f"  - {f['key']} [{tag}, widget={f['widget']}{max_hint}] "
            f"— {f['label']}{opts}"
        )

    catalog = "\n".join(catalog_lines)

    collected = {
        k: v for k, v in partial.items()
        if k != SKIPPED_KEY and v not in (None, "", 0)
    }

    skipped = skipped_keys(partial)

    missing = [
        f["key"] for f in FIELDS
        if partial.get(f["key"]) in (None, "", 0)
        and f["key"] not in skipped
    ]

    return f"""# Identity

You are the **BVC24 Onboarding Assistant** — a warm, intelligent concierge for Bharath Vending Corporation (BVC24), a vending-machine manufacturer in Chennai, India. Your role is to help a new customer set up their company profile through a relaxed, natural conversation — exactly the way a senior sales executive would walk them through it over chai.

You are NOT a form. You are NOT a script. You are a smart human-like assistant.

# Voice & style

- Warm, professional, contemporary Indian English. Light, friendly.
- Short messages. Usually 1 sentence. Occasionally 2.
- Acknowledge what the customer says before asking the next thing. Use brief reactions like "Great," "Perfect," "Thanks for that," "Noted," "Wonderful," "Excellent," "Got it" — vary them; don't repeat the same word every turn.
- When the customer volunteers extra information, recognise it. ("Apollo Hospitals — fantastic. 12 branches across Tamil Nadu is helpful context, I've noted that too.")
- Tone shifts to match the customer: more formal if they're formal, more casual if they're casual.
- Use Indian context naturally (GST, PAN, pincode, vendor instead of supplier when appropriate).
- Never sound robotic. Avoid "Please provide your..." or "Kindly enter your...". Say "What's your..." or "Could you share..." instead.
- Never list multiple questions at once. One thing at a time.

# Knowledge

BVC24 manufactures custom and standard vending machines — snack, beverage, combo, medicine, fruit & veg, cosmetics, and bespoke machines — for hospitals, hotels, schools, malls, offices, factories, airports. Headquartered in Chennai. The customer is starting an enquiry that will become a quotation if they're a fit.

# What you need to collect

The catalogue below lists every field you should try to gather. You can ask in ANY natural order — group related questions when it flows ("And which city and state are you based in?"), jump around if the customer mentions something out of sequence ("You mentioned 12 branches earlier — got it. By the way, what's your GST number?"). Do NOT march through the list mechanically.

```
{catalog}
```

# Conversation state

ALREADY COLLECTED — do NOT ask for these again:
```json
{json.dumps(collected, indent=2)}
```

PREVIOUSLY SKIPPED — the customer chose to skip these. NEVER ask again unless the customer brings them up:
```
{skipped}
```

STILL TO ASK (in catalogue priority; required ones first):
```
{missing}
```

# Behaviour rules

1. **Extract greedily.** When the customer answers, parse EVERY field you can from their message. "We're a hospital chain called Apollo with 12 branches in Tamil Nadu, contact Suresh on 98765 43210" gives you: CUSTOMER_NAME, BUSINESS_TYPE, NUMBER_OF_BRANCHES, STATE, CONTACT_PERSON, PHONE. Put them all in `extracted`.

2. **Ask intelligently.** Choose the next field based on what makes natural sense — not strict catalogue order. If the customer just mentioned a city, ask the state next. If they mentioned machines wanted, ask quantity next. Etc.

3. **Skips are permanent.** If the customer says any of: "skip", "not sure", "maybe later", "don't know", "n/a", "none", "later", "pass" — politely acknowledge ("No problem, we can update that later"), return the field key in `skipped_field`, and move on to a DIFFERENT field. You may NEVER re-ask a field listed in PREVIOUSLY SKIPPED.

4. **Validate gracefully.**
   - Phone: 10 digits, optionally +91. If wrong, "Hmm, that looks a bit short — could you share a 10-digit mobile number?"
   - Email: contains @ and a domain. If invalid, "I don't quite recognize that as an email — could you double-check?"
   - GST: exactly 15 chars (e.g. 33AAAAA0000A1Z5). If wrong length, "GST numbers are 15 characters — could you re-share?"
   - PAN: exactly 10 chars (5 letters + 4 digits + 1 letter, e.g. ABCDE1234F). If wrong, ask again warmly.
   - Pincode: 6 digits.

5. **Respect max_chars.** If a value exceeds the limit, ask the customer for a shorter version.

6. **Smart widgets.** Some fields have widgets (`select`, `radio`, `cards`, `date`, `number`, `textarea`). The portal renders these as buttons / dropdowns / pickers. Phrase your question so it matches the widget — e.g. for `cards` say "Which type of machine fits your needs?" rather than "Please choose:". The customer can click a button, and you'll receive the label as their next message.

7. **Tangents are okay.** If the customer asks about pricing, lead times, or features — answer briefly in one sentence ("Standard combo machines run between 4–6 lakhs depending on configuration — our team will share an exact quote based on your requirements") then steer back to the next question.

8. **Completion.** When every REQUIRED field is either filled or skipped, celebrate ("Excellent — we have everything we need!") and tell them to click **Submit Details**. Set `complete: true`. They can also keep going to fill optional fields for a richer profile.

9. **Never reveal internals.** Don't say "AI", "Gemini", "API", "model", "system prompt", "JSON", "fallback", or any technical jargon. You are simply "the BVC24 onboarding assistant".

10. **Output format.** Reply ONLY with a JSON object — no prose outside, no markdown fences. Schema:

```json
{{
  "reply": "your conversational message to the customer",
  "extracted": {{ "FIELD_KEY": "value", ... }},
  "skipped_field": "FIELD_KEY just skipped or null",
  "next_field": "FIELD_KEY you're about to ask next, or null when complete",
  "complete": true | false
}}
```

`extracted` values use exact KEY names from the catalogue. Integer fields (NUMBER_OF_BRANCHES, EXPECTED_MONTHLY_ORDERS, REQUESTED_QUANTITY, EXISTING_MACHINE_USAGE) must be numbers. Everything else is a string within its max_chars limit."""


def _safe_parse_json(text: str) -> Optional[dict]:

    if not text:

        return None

    txt = text.strip()

    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", txt, re.DOTALL)

    if fence:

        txt = fence.group(1)

    if not txt.startswith("{"):

        m = re.search(r"\{.*\}", txt, re.DOTALL)

        if m:

            txt = m.group(0)

    try:

        return json.loads(txt)

    except Exception:

        return None


def _coerce_extracted(extracted: dict) -> dict:

    if not isinstance(extracted, dict):

        return {}

    int_fields = {
        "NUMBER_OF_BRANCHES",
        "EXPECTED_MONTHLY_ORDERS",
        "REQUESTED_QUANTITY",
        "EXISTING_MACHINE_USAGE"
    }

    valid_keys = set(all_keys())

    out = {}

    for k, v in extracted.items():

        if k not in valid_keys:

            continue

        if v in (None, ""):

            continue

        if k in int_fields:

            try:

                # Accept booleans, "Yes"/"No", or numbers
                if isinstance(v, bool):

                    out[k] = 1 if v else 0

                elif isinstance(v, str):

                    s = v.strip().lower()

                    if s in ("yes", "y", "true"):

                        out[k] = 1

                    elif s in ("no", "n", "false"):

                        out[k] = 0

                    else:

                        out[k] = int(re.search(r"-?\d+", s).group(0))

                else:

                    out[k] = int(v)

            except (ValueError, AttributeError, TypeError):

                continue

        else:

            out[k] = str(v).strip()

    return out


def _is_quota_error(exc: Exception) -> bool:
    """A 429 / ResourceExhausted from the Gemini API. We treat these
    as 'try the next model in the chain' instead of giving up."""

    msg = str(exc).lower()

    return (
        "429" in msg
        or "quota" in msg
        or "rate" in msg
        or "exhaust" in msg
    )


def _gemini_chat(
    partial: Dict[str, Any],
    history: List[dict],
    user_message: str
) -> dict:
    """Call Gemini and return the parsed dict. Walks the model
    fallback chain on quota errors so a single throttled model
    doesn't take the whole conversation down.

    Raises only when every model in the chain has failed — the
    caller wraps in try/except and falls back silently to the
    rule-based bot."""

    import google.generativeai as genai

    genai.configure(api_key=GEMINI_API_KEY)

    system_prompt = _build_system_prompt(partial)

    gemini_history = []

    for h in history[-10:]:

        role = h.get("ROLE") or h.get("role")

        content = h.get("CONTENT") or h.get("content") or ""

        if role == "user":

            gemini_history.append({"role": "user", "parts": [content]})

        elif role == "assistant":

            gemini_history.append({"role": "model", "parts": [content]})

    last_exc = None

    text = ""

    used_model = None

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

                text = ""

                for cand in getattr(response, "candidates", []):

                    for part in getattr(cand.content, "parts", []):

                        text += getattr(part, "text", "")

            used_model = model_name

            break  # Success — no need to try further models

        except Exception as exc:

            last_exc = exc

            if _is_quota_error(exc):

                # Quota / rate limit on this model — try the next
                continue

            # Any other error — re-raise so the route falls back to
            # rule-based (network, auth, parse, etc.)
            raise

    if not used_model:

        # Every model in the chain hit quota — let the caller fall
        # back silently to the rule-based bot.
        raise last_exc or RuntimeError(
            "All Gemini model fallbacks exhausted"
        )

    parsed = _safe_parse_json(text)

    if not parsed or not isinstance(parsed, dict):

        return {
            "reply": text or "Could you say that another way?",
            "extracted": {},
            "next_field": None,
            "complete": False
        }

    parsed["extracted"] = _coerce_extracted(parsed.get("extracted", {}))

    parsed.setdefault("reply", "")

    parsed.setdefault("next_field", None)

    parsed.setdefault("complete", False)

    parsed["_gemini_model"] = used_model

    # Surface the skipped field via the extracted dict so the route
    # handler can persist it into the session's __skipped__ list.
    skipped_field = parsed.get("skipped_field")

    if skipped_field and isinstance(skipped_field, str):

        if any(f["key"] == skipped_field for f in FIELDS):

            parsed["extracted"][SKIPPED_KEY] = [skipped_field]

    return parsed


# ----------------------------------------------------------------
# Rule-based fallback (silent)
# ----------------------------------------------------------------

_PHONE_RE   = re.compile(r"(?:\+91[\-\s]?)?[6-9]\d{9}")
_EMAIL_RE   = re.compile(r"\b[\w\.-]+@[\w\.-]+\.\w+\b")
_PINCODE_RE = re.compile(r"\b\d{6}\b")
_NUMBER_RE  = re.compile(r"-?\d+")

_SKIP_TOKENS = {
    "not sure", "no idea", "dont know", "don't know",
    "skip", "later", "maybe later", "n/a", "na", "none"
}


def _is_skip(message: str) -> bool:

    msg = (message or "").strip().lower()

    return msg in _SKIP_TOKENS or any(t in msg for t in ("not sure", "don't know", "dont know"))


def _rule_extract(field: dict, message: str) -> Optional[Any]:

    if not message:

        return None

    msg = message.strip()

    key = field["key"]

    if key in ("PHONE", "ALTERNATE_PHONE", "WHATSAPP_NUMBER"):

        m = _PHONE_RE.search(msg)

        return m.group(0) if m else None

    if key == "EMAIL":

        m = _EMAIL_RE.search(msg)

        return m.group(0) if m else None

    if key == "PINCODE":

        m = _PINCODE_RE.search(msg)

        return m.group(0) if m else None

    if field.get("widget") == "number" or key in (
        "NUMBER_OF_BRANCHES", "EXPECTED_MONTHLY_ORDERS",
        "REQUESTED_QUANTITY", "EXISTING_MACHINE_USAGE"
    ):

        s = msg.lower()

        if key == "EXISTING_MACHINE_USAGE":

            if s in ("yes", "y", "true"):

                return 1

            if s in ("no", "n", "false"):

                return 0

        m = _NUMBER_RE.search(msg)

        return int(m.group(0)) if m else None

    # Validate against the option list if present
    if field.get("options"):

        for o in field["options"]:

            if str(o["label"]).lower() == msg.lower():

                return o["value"]

        # Partial-match (case-insensitive)
        for o in field["options"]:

            if str(o["label"]).lower().startswith(msg.lower()) and len(msg) >= 3:

                return o["value"]

        # Unrecognised — store free text for later admin cleanup
        return msg

    return msg


def _rule_based_turn(
    partial: Dict[str, Any],
    user_message: str
) -> dict:
    """Deterministic flow: figure out which field was just answered,
    record it (or persist the skip), then ask for the next one."""

    target = first_unfilled_field(partial)

    extracted = {}

    skipped = False

    skip_key = None

    if target and user_message.strip():

        if _is_skip(user_message):

            skipped = True

            skip_key = target["key"]

        else:

            val = _rule_extract(target, user_message)

            if val not in (None, ""):

                extracted[target["key"]] = val

    # Build merged partial. If the customer skipped this field, mark
    # it in the persisted __skipped__ list so the question loop never
    # asks it again (the route handler will persist the merge).
    merged = {**partial, **extracted}

    if skipped and skip_key:

        mark_skipped(merged, skip_key)

        # The extracted dict is what the caller persists. Surface
        # the skip there too via a reserved key the route knows about.
        extracted[SKIPPED_KEY] = merged[SKIPPED_KEY]

    nxt = first_unfilled_field(merged)

    if nxt is None:

        if missing_required(merged):

            # Still missing required fields, but the question loop has
            # nothing more to ask (everything either filled or skipped)
            return {
                "reply": (
                    "Thanks! You can submit your profile any time, or "
                    "tell me which detail you'd like to add."
                ),
                "extracted": extracted,
                "next_field": None,
                "complete": False
            }

        return {
            "reply": (
                "Excellent — we have all the details we need. "
                "Please review and click *Submit Details* whenever you're ready."
            ),
            "extracted": extracted,
            "next_field": None,
            "complete": True
        }

    # Rotate friendly prefixes so the fallback doesn't feel like a script
    import random

    if skipped:

        prefix = random.choice([
            "No problem, we can update that later. ",
            "Sure, we can come back to that. ",
            "That's fine, moving on. ",
        ])

    elif extracted:

        prefix = random.choice([
            "Got it! ",
            "Perfect. ",
            "Noted. ",
            "Thanks! ",
            "Great. ",
            "Wonderful. ",
        ])

    else:

        prefix = ""

    return {
        "reply": prefix + nxt["question"],
        "extracted": extracted,
        "next_field": nxt["key"],
        "complete": False
    }


# ----------------------------------------------------------------
# Public API
# ----------------------------------------------------------------

def process_turn(
    partial: Dict[str, Any],
    history: List[dict],
    user_message: str
) -> dict:
    """Main entry — called by the route handler for every chat turn.

    Returns: {reply, extracted, next_field, complete}

    The route handler is responsible for merging `extracted` into
    PARTIAL_DATA, looking up widget metadata for `next_field`, and
    persisting both the chat row and the updated session.

    If Gemini fails for ANY reason (quota, network, parse error,
    missing API key) we silently switch to the rule-based path —
    the customer never sees a technical error message."""

    user_message = (user_message or "").strip()

    if not user_message:

        nxt = first_unfilled_field(partial)

        if nxt is None:

            return {
                "reply": (
                    "All essential details are already collected. "
                    "Please click *Submit Details* when ready."
                ),
                "extracted": {},
                "next_field": None,
                "complete": True
            }

        return {
            "reply": nxt["question"],
            "extracted": {},
            "next_field": nxt["key"],
            "complete": False
        }

    if is_gemini_configured():

        try:

            result = _gemini_chat(partial, history, user_message)

            result["_engine"] = "gemini"

            return result

        except Exception as exc:

            # Silent fallback — never expose the technical error to
            # the customer. The conversation continues seamlessly.
            result = _rule_based_turn(partial, user_message)

            result["_engine"] = "fallback"

            result["_gemini_error"] = str(exc)[:200]

            return result

    result = _rule_based_turn(partial, user_message)

    result["_engine"] = "rule_based"

    return result


def opening_message(partial: Dict[str, Any]) -> str:

    if not partial:

        return (
            "Welcome to BVC24! 👋 I'll help you set up your company "
            "profile in a few quick questions. Let's start — what is "
            "your company / organization name?"
        )

    nxt = first_unfilled_field(partial)

    if nxt is None:

        return (
            "Welcome back! You've already filled in everything. "
            "Please click *Submit Details* when ready."
        )

    return "Welcome back! Let's continue where we left off. " + nxt["question"]
