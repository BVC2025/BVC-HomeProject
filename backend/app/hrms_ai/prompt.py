"""
Prompt construction for the HRMS AI assistant.

Two prompts live here:

  build_answer_prompt(...)   -> str  (system instruction for the main
                                       answer generation)
  build_grounding_prompt(...) -> str (prompt sent to a second, minimal
                                       Gemini call to verify the answer
                                       is supported by the retrieved
                                       context — catches hallucinations)

The design is aggressively defensive: the system prompt tells Gemini
to answer ONLY from the provided context, respond in the same language
as the user's message, and to explicitly say when the answer isn't
in the docs. Temperature is kept low (0.2) at the call site.
"""

from __future__ import annotations

from typing import Iterable, List, Optional


# =====================================================================
# System instruction — the assistant's guardrails
# =====================================================================

SYSTEM_INSTRUCTION = """You are the BVC24 HRMS Assistant, a helpful document-grounded AI. Your job is to help employees understand the company's HRMS by answering their questions using the reference material provided to you in each turn.

# Absolute rules

1. Use the material inside the "HRMS KNOWLEDGE" block as your source of truth for factual claims. Never invent policies, numbers, endpoints, roles, or workflows that are not in that block.

2. BE HELPFUL FIRST. If the knowledge block contains information related to the question — even if it doesn't answer the question word-for-word — synthesise a useful reply from what IS there. Employees ask questions in many ways ("how much leave do I get", "casual leave allowance", "how many CL per year") that all point at the same underlying fact. Match intent, not exact phrasing.

3. Only refuse when the knowledge block truly has nothing relevant to the question. In that case reply:
     "I don't have that information in the HRMS documentation. Please contact HR for clarification."
   Before refusing, re-read the retrieved chunks — often the answer is there under different wording.

4. If the question is ambiguous, either ask one short clarifying question, OR pick the most likely interpretation and answer with a caveat ("Assuming you mean X: …"). Don't refuse for ambiguity alone.

5. NEVER provide the following even if asked:
   - Legal or tax advice
   - Personal opinions about employees or management
   - Any content outside HRMS scope (weather, news, entertainment, other software)
   For anything out of scope, politely say the assistant only covers the BVC24 HRMS.

# Language

- Detect the language of the user's most recent message and respond in the SAME language.
- If the user typed in English, answer in English. If in Tamil, answer in Tamil. If in Hindi, answer in Hindi. Same for any other language.
- If the language is ambiguous, default to English.
- Keep terminology consistent with the source doc — module names like "Attendance", "Leave", "Payroll" stay as-is even when the surrounding sentence is in another language, because those are proper feature names.

# Style

- Be concise. 2-6 sentences unless the user explicitly asks for detail.
- Use bullet points for lists of rules or steps.
- Cite the source module implicitly by naming it: "According to the Attendance module, ...".
- Never quote raw code, endpoint paths, or database table names — those are for developers, not employees.
- If numbers/thresholds are mentioned, state them exactly as written in the doc.

# What you are NOT

You are not an approver. You cannot approve leaves, apply for permissions, generate payslips, edit records, or take any action inside the ERP. If the user asks you to DO something, direct them to the correct page in the ERP (e.g., "Please open the Leave page and click 'Apply for leave' — I can only tell you how the process works.").
"""


# =====================================================================
# Context assembly
# =====================================================================

def _format_chunk(chunk: dict, score: Optional[float] = None) -> str:
    """Render one retrieved chunk as a block inside the knowledge
    section of the prompt. Score is included as a comment so we can
    debug low-confidence responses via logs — Gemini ignores it."""

    module = chunk.get("module", "General")
    section = chunk.get("section", "")
    text = chunk.get("text", "").strip()
    header = f"[{module} → {section}]"
    if score is not None:
        header += f"   (relevance: {score:.2f})"
    return f"{header}\n{text}"


def build_answer_prompt(
    question: str,
    retrieved: Iterable,
    conversation: Optional[List[dict]] = None,
    language_hint: Optional[str] = None,
) -> str:
    """The final USER-role message we send to Gemini. Everything
    that follows the SYSTEM instruction is the retrieved knowledge
    plus the current question. Prior turns go in as chat history
    (not concatenated here) so Gemini's built-in coreference works."""

    # retrieved is an iterable of (chunk, score) tuples
    chunk_blocks = []
    for item in retrieved:
        if isinstance(item, tuple):
            chunk, score = item
        else:
            chunk, score = item, None
        chunk_blocks.append(_format_chunk(chunk, score))

    knowledge_section = "\n\n---\n\n".join(chunk_blocks) if chunk_blocks else "(no relevant sections retrieved)"

    parts: List[str] = [
        "=== HRMS KNOWLEDGE (the ONLY source you may use for facts) ===",
        "",
        knowledge_section,
        "",
        "=== END OF HRMS KNOWLEDGE ===",
        "",
    ]

    if language_hint:
        parts.append(f"[Preferred response language: {language_hint}]")
        parts.append("")

    parts.append(f"User question: {question}")
    return "\n".join(parts)


# =====================================================================
# Grounding-check prompt
# =====================================================================

def build_grounding_prompt(question: str, answer: str, retrieved: Iterable) -> str:
    """Sent to a second Gemini call — asks whether the answer is
    reasonably supported by the retrieved context. Returns YES / NO.

    Design note: this used to demand FULL support (exact-text match).
    That over-rejected perfectly good paraphrases and cross-language
    answers. The check now looks for KEY FACTS in the context, not
    exact wording — hallucinations still get caught, but a Tamil
    reply to a Tamil question about a rule that IS in the English
    docs no longer gets nuked."""

    chunk_blocks = []
    for item in retrieved:
        if isinstance(item, tuple):
            chunk, _ = item
        else:
            chunk = item
        chunk_blocks.append(_format_chunk(chunk))

    context = "\n\n---\n\n".join(chunk_blocks) if chunk_blocks else "(none)"

    return (
        "You are checking whether an assistant's answer is grounded in "
        "the provided context. Rules:\n"
        "  - YES if the KEY FACTS in the answer (numbers, policies, "
        "    procedures) can be traced to the context. Paraphrasing, "
        "    translation to another language, and combining facts from "
        "    multiple chunks are all FINE.\n"
        "  - YES if the answer is a canned refusal like 'I don't have "
        "    that information'.\n"
        "  - NO only if the answer introduces specific facts (a number, "
        "    a policy, a procedure) that CANNOT be found anywhere in "
        "    the context.\n"
        "  - When in doubt, prefer YES. Being over-cautious hurts users "
        "    more than an occasional imperfect answer does.\n\n"
        f"USER QUESTION: {question}\n\n"
        "CONTEXT:\n"
        f"{context}\n\n"
        f"ASSISTANT ANSWER:\n{answer}\n\n"
        "Is the answer reasonably grounded in the context? "
        "Reply with only YES or NO."
    )


# =====================================================================
# Canned reply when RAG returns nothing
# =====================================================================

NO_CONTEXT_REPLY = (
    "I don't have that information in the HRMS documentation. "
    "Please contact HR for clarification."
)
