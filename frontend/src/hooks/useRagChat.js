import { useCallback, useRef, useState } from "react";
import API from "../services/api";

// Shared SSE chat driver for the RAG AI Platform — used by both the
// AI Playground page and the Lead AI Assistant panel. Both need
// identical SSE parsing (text/chunks/confidence/usage/error/done), so
// unlike the backend's deliberate llm_client/gemini_service split, this
// one really is the same logic twice — a shared hook avoids duplicating it.

function newSessionId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useRagChat(moduleCode, { verbose = false } = {}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef(newSessionId());

  const buildHistory = useCallback((msgs) => {
    return msgs.slice(-10).map((m) => ({
      role: m.from === "user" ? "user" : "model",
      text: typeof m.text === "string" ? m.text : "",
    }));
  }, []);

  const send = useCallback(
    async (textArg) => {
      const text = (textArg || "").trim();
      if (!text || loading || !moduleCode) return;

      setMessages((m) => [...m, { from: "user", text }]);
      setLoading(true);

      setMessages((m) => [
        ...m,
        { from: "bot", text: "", streaming: true, chunks: [], confidence: null, usage: null },
      ]);

      const patchBot = (patch) => {
        setMessages((m) => {
          const next = [...m];
          const last = { ...next[next.length - 1] };
          if (patch.text != null) last.text = (last.text || "") + patch.text;
          if (patch.chunks) last.chunks = patch.chunks;
          if (patch.confidence != null) last.confidence = patch.confidence;
          if (patch.usage) last.usage = patch.usage;
          if (patch.error) last.error = patch.error;
          if (patch.done) last.streaming = false;
          next[next.length - 1] = last;
          return next;
        });
      };

      try {
        const baseURL = API.defaults.baseURL || "";
        const path = verbose ? "/rag/playground/chat/stream" : "/rag/chat/stream";
        const url = baseURL.replace(/\/+$/, "") + path;
        const token = localStorage.getItem("token");
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            module_code: moduleCode,
            message: text,
            session_id: sessionIdRef.current,
            history: buildHistory(messages),
          }),
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const rawFrame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            const dataLine = rawFrame
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.startsWith("data:"));

            if (!dataLine) continue;

            let evt;
            try {
              evt = JSON.parse(dataLine.replace(/^data:\s*/, ""));
            } catch {
              continue;
            }

            if (evt.type === "text") patchBot({ text: evt.text });
            else if (evt.type === "chunks") patchBot({ chunks: evt.chunks });
            else if (evt.type === "confidence") patchBot({ confidence: evt.score });
            else if (evt.type === "usage") patchBot({ usage: evt });
            else if (evt.type === "error") patchBot({ error: evt.message, done: true });
            else if (evt.type === "done") patchBot({ done: true });
          }
        }

        patchBot({ done: true });
      } catch (e) {
        patchBot({ error: "Could not reach the AI service. Is the backend running?", done: true });
      } finally {
        setLoading(false);
      }
    },
    [loading, moduleCode, messages, verbose, buildHistory]
  );

  return { messages, send, loading, sessionId: sessionIdRef.current };
}
