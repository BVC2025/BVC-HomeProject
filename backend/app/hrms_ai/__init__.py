"""
HRMS AI Assistant — Gemini-powered RAG over docs/HRMS_KNOWLEDGE.md.

Self-contained module. Only external dependency inside the app is the
JWT auth helper. Does not import from any existing chatbot code; those
files are being deleted in the same change.

Behaviour:
  - Answers strictly from the knowledge base (RAG)
  - Multi-language: detects user language and responds in the same one
  - Read-only: never mutates HRMS data; only writes to its own
    hrms_ai_conversation table
  - Feature-flagged via HRMS_AI_ENABLED in .env (default: true)
"""
