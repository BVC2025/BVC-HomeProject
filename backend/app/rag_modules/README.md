# RAG Modules — onboarding guide

This folder is the common Enterprise RAG AI Platform's engine. `core/` is
the generic, module-agnostic pipeline (ingestion, chunking, embedding,
Qdrant, retrieval, chat). Everything else is a small, per-module folder
that only holds a system prompt (and, later, module-specific tools) — never
new route or pipeline code.

## Onboarding a new module (e.g. "Sales")

1. Insert one row in `AI_MODULES`:
   - `MODULE_CODE="sales"`, `MODULE_NAME="Sales AI Assistant"`
   - `VECTOR_COLLECTION_NAME="sales_rag_collection"` (must be unique)
   - `EMBEDDING_MODEL="BAAI/bge-small-en-v1.5"` (same for every module in v1)
   - `LLM_MODEL` = whatever `GEMINI_MODEL` resolves to
2. Create `backend/app/rag_modules/sales_rag_module/prompts.py` with a
   `SYSTEM_PROMPT` string constant describing the Sales AI Assistant's
   persona and scope (see `lead_rag_module/prompts.py` for the template).
3. That's it. Every endpoint in `app/routes/rag.py`, the ingestion
   pipeline, and the chat orchestrator already parameterize on
   `module_code` — uploading a document with `module_code=sales` and
   chatting with `module_code=sales` works immediately, with zero changes
   to `core/` or `routes/rag.py`.

An optional `tools.py` (with a `TOOLS` list) can be added later per module
for function-calling agents — `module_registry.get_tools()` already looks
for it and returns `[]` if absent.

## Deferred to v2 (by design, not oversight)

- **Semantic chunking** — `core/chunker.py` currently does
  paragraph/sentence-based recursive splitting. Sentence-embedding
  boundary detection is a nice-to-have, not required for v1 quality.
- **Future SQL query agent** — would register as a tool in a module's
  `tools.py`, called through the same Gemini function-calling shape already
  present in `core/llm_client.py`. Needs read-only, whitelisted-table DB
  access. Critical: this ERP has TWO distinct "lead" concepts (the `lead`
  table vs. the `Customer`/`CustomerRequirement` public-enquiry pipeline) —
  any future SQL agent must disambiguate which one a question refers to
  (see `lead_rag_module/prompts.py` for the exact distinction).
- **Multi-agent routing** — `chat_orchestrator.run_chat()` already isolates
  per-module prompt+tools behind `module_code`; a future top-level router
  agent just picks a `module_code` before delegating.
- **WhatsApp / Email / Voice channels** — `run_chat()` is a plain generator
  with no HTTP/SSE assumption baked in; a webhook handler or poller can
  drain it directly and forward the final text through its own transport.
- **The general ERP chatbot** (`app/routes/chatbot.py`) can migrate onto
  this platform later as just another module (e.g. `MODULE_CODE="erp-general"`)
  instead of building a second, separate RAG system — this platform
  supersedes `docs/CHATBOT_BUILD_PLAN.md`.
