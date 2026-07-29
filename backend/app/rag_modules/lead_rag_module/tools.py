"""Future function-calling tools for the Lead AI Assistant (e.g. a SQL
query agent answering "show today's IndiaMART leads"). Empty in v1 — see
rag_modules/README.md's "Future SQL query agent" section for the intended
shape. module_registry.get_tools() already looks for a TOOLS list here, so
adding real tools later requires no core-engine change."""

TOOLS = []
