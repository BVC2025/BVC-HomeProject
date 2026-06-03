# Module 14 — Chatbot & HR Assistant

## 14.1 Purpose

BVC24 ships with two conversational helpers:

1. **General ERP Chatbot** — an LLM-backed assistant (Google Gemini) that answers questions about how to use the system, what a field means, where to find a report.
2. **HR Assistant** — a rule-based bot that walks an employee through filing a leave application in natural language.

The two are intentionally separated: the HR Assistant runs on a deterministic state machine that never produces a wrong leave-policy answer; the general chatbot can be richer but is gated by feature-flag (no Gemini key → friendly fallback message).

## 14.2 Screens

- **ChatBot** (component) — floating chat widget at the bottom-right of every authenticated page.
- **HRAssistant** (component) — floats over the ApplyLeave screen, walks the employee through the form via dialogue.

## 14.3 General ERP Chatbot

### Service — `gemini_service.py`

- Configured via `GEMINI_API_KEY` env var.
- Default model: `gemini-1.5-flash` (overridable via `GEMINI_MODEL`).
- The bot is given a **system prompt** that scopes it to BVC24 questions only:

  > "You are the BVC24 ERP assistant for Bharath Vending Corporation. You only answer questions about how to use this ERP system (CRM, quotations, sales orders, production, inventory, payroll). For anything outside this scope, politely decline."

- Chat history is **not** persisted server-side — each request carries the conversation as an array. This keeps state on the client (in React) and avoids cross-user leakage.

### Endpoints

```
POST /chat
{ MESSAGES: [ {ROLE: "user", CONTENT: "..."}, ... ] }
→ { REPLY: "...", SUGGESTIONS: [...] }

POST /chat/stream
(streaming response, useful for long answers)

GET  /chat/health
→ { OK: true, MODEL: "gemini-1.5-flash", CONFIGURED: true }

GET  /chat/suggestions
→ [ "How do I send a quotation?", "Where do I see my leave balance?", ... ]
```

### Behaviour without an API key

If `GEMINI_API_KEY` is not set:

```
POST /chat returns:
{ REPLY: "The ERP chatbot is not configured. Please ask your
          administrator to add the GEMINI_API_KEY to enable
          conversational support." }
```

The UI shows a friendly icon and the user can dismiss the widget. Core ERP functionality is unaffected.

## 14.4 HR Assistant

### Service — `hr_assistant.py` (route + service)

A **stateless rule-based bot** for filing a leave request through conversation. The HR Assistant:

- Lives entirely in `hr_assistant.py` (no external LLM).
- Uses a state machine pattern — the client echoes back the current conversation state with each message.
- Validates against the actual leave balance / policy server-side.

### Conversation flow

```
S1. GREETING
    Bot: "Hi, I'm the HR assistant. Do you want to apply for leave today?"
    User: "yes" / "no" / "maybe later"

S2. ASK_LEAVE_TYPE
    Bot: "What type of leave? Casual, Sick, Earned, or Unpaid?"
    User: "casual"
    → Bot checks LeaveBalance.CASUAL_TOTAL - CASUAL_USED

S3. ASK_START_DATE
    Bot: "When does your leave start? (Tell me the date or 'tomorrow')"
    User: "2 June" / "tomorrow"

S4. ASK_END_DATE
    Bot: "And when do you return?"
    User: "4 June"
    → Bot computes DAYS, checks against remaining balance

S5. ASK_REASON
    Bot: "Briefly, what's the reason?"
    User: "Family wedding in Madurai."

S6. CONFIRM
    Bot: "OK, to confirm: 3 days Casual Leave from 2 to 4 June.
          Reason: Family wedding in Madurai. Shall I submit this?"
    User: "yes"

S7. SUBMITTED
    Bot calls leave_service.apply_leave(...)
    → LeaveRequest row, email to APPROVER_EMAIL
    Bot: "Submitted. You'll get an email once your manager
          approves. Application ID: LR-2026-0042"
```

### Endpoints

```
POST /hr-bot/message
{ MESSAGE: "...", STATE: { ... },
  EMPLOYEE_CODE: "EMP003" }
→ { REPLY: "...", STATE: {...}, ACTION?: "submit_leave" }

GET  /hr-bot/policy
→ { POLICY_TEXT: "Casual leave: 12 days/year. Sick leave..." }

GET  /hr-bot/diagnose
→ { OK: true, USES_GEMINI: false, RULES_LOADED: 27 }
```

### Why rule-based?

- Leave policy is deterministic — the answer to "how many CL do I have left?" is a database query, not a probabilistic prediction.
- Operates without an internet connection or API key.
- Cannot hallucinate a policy ("you have 30 CL" when the limit is 12).
- Easier to audit — every state transition is in source code.

### Why a chat UI for it then?

Floor employees in a manufacturing setting are often more comfortable with a Tamil/English mixed conversation than navigating a form. The HR Assistant has been tested in shop-floor pilots and reduces leave-form errors significantly.

## 14.5 Bot Widget UX

Both bots use a shared floating widget pattern:

- Circular floating action button at the bottom-right (BVC red gradient).
- Click expands a chat panel (~400 × 600 px) with conversation thread.
- User bubble: BVC red gradient `linear-gradient(135deg, #C8102E, #8B0B1F)`.
- Bot bubble: light slate with subtle border.
- Suggestion chips below the input: pink/red gradient (BVC theme).
- The widget remembers position and open/closed state in `localStorage`.

## 14.6 Future Work

- **Voice input** (web Speech API) — already scoped, not yet wired.
- **Tamil-language toggle** for the HR Assistant — partial UI strings ready.
- **Per-department FAQ injection** for the Gemini bot — sales team gets sales-specific examples, production gets stage examples.
- **Knowledge base** — feed the Gemini bot the documentation in this folder as RAG context.

---

Next: [Module 15 — Dashboard & Analytics](./15-dashboard-analytics.md)
