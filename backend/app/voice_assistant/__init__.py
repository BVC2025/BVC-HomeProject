"""
Voice-first employee assistant.

Layers (top → bottom):

  routes.py            — /voice/query FastAPI endpoint (presentation)
  intent_router.py     — dispatches sessions to a handler (application)
  intent_extractor.py  — calls Gemini for intent + entity JSON  (AI)
  handlers/            — business logic per intent               (service)
  session_store.py     — per-session memory                      (state)
  schemas.py           — request/response models                 (types)

Rules:
  • Gemini extracts intent + entities. NEVER writes to the DB.
  • Handlers hold ALL business rules and touch the DB.
  • Every reply MUST come from a handler — Gemini's raw response
    is used only to route to a handler and to phrase clarifiers.
"""
