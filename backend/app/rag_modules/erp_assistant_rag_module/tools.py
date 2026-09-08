"""Future function-calling tools for the ERP Assistant (e.g. "what's my
leave balance" as a live DB lookup instead of a document chunk). Empty in
v1 — module_registry.get_tools()/get_tool_resolver() already look for
TOOLS/resolve() here, so adding real tools later requires no core-engine
change. Also: the Ollama/Qwen3 provider path (core/ollama_llm_client.py)
doesn't implement tool-calling yet, so tools added here won't be invoked
until that lands."""

TOOLS = []
