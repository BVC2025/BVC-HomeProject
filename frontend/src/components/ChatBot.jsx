import { useState, useEffect, useRef } from "react";
import API from "../services/api";
import styles from "./ChatBot.module.css";


function BotIcon() {

  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M12 8V4" />
      <circle cx="12" cy="3" r="1" />
      <path d="M8 14h.01" />
      <path d="M16 14h.01" />
      <path d="M9 18h6" />
    </svg>
  );
}


function SendIcon() {

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}


function CloseIcon() {

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}


export default function ChatBot() {

  const [open, setOpen] = useState(false);

  const [messages, setMessages] = useState([
    {
      from: "bot",
      reply: (
        "👋 Hi! I'm your BVC24 AI assistant. I can answer "
        + "live questions about every module — Production, "
        + "Quality, Suppliers, Leave, Performance, Biometric "
        + "and more. Try a suggestion below, or just ask in "
        + "plain English. Type 'help' for the full menu."
      ),
      items: [],
      suggestions: []
    }
  ]);

  const [input, setInput] = useState("");

  const [loading, setLoading] = useState(false);

  const [quickSuggestions, setQuickSuggestions] = useState([
    "BVC24 overview",
    "Production status",
    "Quality status",
    "Who is in office",
    "Pending leave",
    "Performance summary",
    "List suppliers",
    "Help"
  ]);

  const scrollRef = useRef(null);

  useEffect(() => {

    if (scrollRef.current) {

      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

  }, [messages, loading, open]);

  useEffect(() => {

    if (!open) return;

    API.get("/chat/suggestions").then((res) => {

      if (res.data?.suggestions?.length) {

        setQuickSuggestions(res.data.suggestions);
      }

    }).catch(() => {});

  }, [open]);


  // Track which router answered (rules / leave / gemini) for the in-flight reply
  const [streamingMode, setStreamingMode] = useState(null);

  // ---- Leave workflow state — multi-turn conversation context ----
  // Stored per-employee in localStorage so refreshing the page doesn't
  // lose a half-finished leave request. Cleared once the request is
  // submitted (or the user cancels).
  const employeeId = (() => {

    try {

      return localStorage.getItem("employee_id")
        || localStorage.getItem("EMPLOYEE_ID")
        || null;

    } catch { return null; }
  })();

  const LEAVE_STATE_KEY = employeeId ? `chatbot_leave_state_${employeeId}` : null;

  const readLeaveState = () => {

    if (!LEAVE_STATE_KEY) return {};

    try {

      const raw = localStorage.getItem(LEAVE_STATE_KEY);

      return raw ? JSON.parse(raw) : {};

    } catch { return {}; }
  };

  const writeLeaveState = (state) => {

    if (!LEAVE_STATE_KEY) return;

    try {

      if (!state || Object.keys(state).length === 0) {

        localStorage.removeItem(LEAVE_STATE_KEY);

      } else {

        localStorage.setItem(LEAVE_STATE_KEY, JSON.stringify(state));
      }

    } catch { /* ignore */ }
  };

  // Keep a short history that we send to Gemini so multi-turn works
  const buildHistory = (msgs) => {

    // Skip the welcome message; include the last 10 turns
    const slice = msgs.slice(1).slice(-10);

    return slice.map((m) => ({
      role: m.from === "user" ? "user" : "model",
      text: typeof m.reply === "string" ? m.reply : ""
    }));
  };

  const send = async (textArg) => {

    const text = (textArg ?? input).trim();

    if (!text || loading) return;

    setMessages((m) => [
      ...m,
      { from: "user", reply: text }
    ]);

    setInput("");

    setLoading(true);

    setStreamingMode(null);

    // Push an empty bot message that we will progressively fill
    setMessages((m) => [
      ...m,
      {
        from: "bot",
        reply: "",
        items: [],
        suggestions: [],
        tools: [],
        source: null,
        streaming: true
      }
    ]);

    const appendToBot = (patch) => {

      setMessages((m) => {

        const next = [...m];

        const last = { ...next[next.length - 1] };

        if (patch.text != null) {

          last.reply = (last.reply || "") + patch.text;
        }

        if (patch.items) last.items = patch.items;

        if (patch.suggestions) last.suggestions = patch.suggestions;

        if (patch.tool) {

          last.tools = [...(last.tools || []), patch.tool];
        }

        if (patch.source) last.source = patch.source;

        if (patch.done) last.streaming = false;

        next[next.length - 1] = last;

        return next;
      });
    };

    try {

      // Build absolute URL using axios baseURL so streaming works
      // even when frontend runs on a different port than backend.
      const baseURL = API.defaults.baseURL || "";

      const url = baseURL.replace(/\/+$/, "") + "/chat/stream";

      const token = localStorage.getItem("token");

      const headers = { "Content-Type": "application/json" };

      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: text,
          history: buildHistory(messages),
          // ---- Leave workflow context (employee portal only) ----
          // Backend uses these to detect leave intents and run the
          // multi-turn collect → confirm → submit conversation.
          employee_id: employeeId,
          leave_state: readLeaveState()
        })
      });

      if (!res.ok || !res.body) {

        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();

      const decoder = new TextDecoder();

      let buffer = "";

      while (true) {

        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are split by \n\n
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

          } catch (e) {

            continue;
          }

          if (evt.type === "source") {

            setStreamingMode(evt.source);

            appendToBot({ source: evt.source });

          } else if (evt.type === "text") {

            appendToBot({ text: evt.text });

          } else if (evt.type === "tool") {

            appendToBot({
              tool: { name: evt.name, args: evt.args }
            });

          } else if (evt.type === "items") {

            appendToBot({ items: evt.items });

          } else if (evt.type === "suggestions") {

            appendToBot({ suggestions: evt.suggestions });

          } else if (evt.type === "leave_state") {

            // Backend echoes back the merged leave conversation state.
            // Persist so the next turn (or page refresh) continues
            // where we left off. An empty {} state means the flow
            // just finished (submitted or cancelled).
            writeLeaveState(evt.state || {});

          } else if (evt.type === "error") {

            appendToBot({
              text: `\n\n⚠️ ${evt.message}`,
              done: true
            });

          } else if (evt.type === "done") {

            appendToBot({ done: true });
          }
        }
      }

      // Flush any final partial frame (shouldn't normally happen)
      appendToBot({ done: true });

    } catch (e) {

      appendToBot({
        text: (
          "\n\n⚠️ Could not reach the chatbot service. "
          + "Make sure the backend is running."
        ),
        done: true
      });

    } finally {

      setLoading(false);
    }
  };


  const onKey = (e) => {

    if (e.key === "Enter" && !e.shiftKey) {

      e.preventDefault();

      send();
    }
  };


  if (!open) {

    return (
      <button
        className={styles.bubble}
        onClick={() => setOpen(true)}
        title="ERP Assistant"
      >
        <BotIcon />
      </button>
    );
  }


  return (
    <div className={styles.panel}>

      <div className={styles.header}>

        <div className={styles.headerLeft}>

          <div className={styles.headerAvatar}>
            <BotIcon />
          </div>

          <div>
            <div className={styles.headerTitle}>
              ERP Assistant
            </div>
            <div className={styles.headerSub}>
              Always free · No API cost
            </div>
          </div>

        </div>

        <button
          onClick={() => setOpen(false)}
          className={styles.closeBtn}
          title="Close"
        >
          <CloseIcon />
        </button>

      </div>

      <div ref={scrollRef} className={styles.body}>

        <div className={styles.messageList}>

          {messages.map((m, i) => (

            <div
              key={i}
              className={
                m.from === "user"
                  ? styles.userBubble
                  : styles.botBubble
              }
            >

              {/* Source badge — small chip showing rules vs gemini */}
              {m.from === "bot" && m.source && (
                <div className={styles.sourceBadge}>
                  <span
                    className={
                      m.source === "gemini"
                        ? styles.sourceBadgeGemini
                        : styles.sourceBadgeRule
                    }
                  >
                    {m.source === "gemini"
                      ? "✨ Gemini AI"
                      : "⚡ Rule-based"}
                  </span>
                </div>
              )}

              {/* Tool-call breadcrumbs */}
              {m.from === "bot" && m.tools && m.tools.length > 0 && (
                <div className={styles.toolCrumbs}>
                  {m.tools.map((tc, k) => (
                    <div
                      key={k}
                      className={styles.toolCrumb}
                    >
                      🔧 {tc.name}
                      {tc.args && Object.keys(tc.args).length > 0 && (
                        <span className={styles.toolCrumbArgs}>
                          ({Object.entries(tc.args)
                            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                            .join(", ")})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div>
                {m.reply}
                {m.streaming && (
                  <span className={styles.cursor} />
                )}
              </div>

              {m.items && m.items.length > 0 && (
                <div className={styles.itemList}>
                  {m.items.map((it, j) => (
                    <div key={j} className={styles.itemRow}>
                      <span className={styles.itemLabel}>{it.label}</span>
                      <span className={styles.itemValue}>
                        {it.value != null ? it.value : it.meta}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {m.suggestions && m.suggestions.length > 0 && (
                <div className={styles.chipRow}>
                  {m.suggestions.map((s, j) => (
                    <button
                      key={j}
                      className={styles.chip}
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

            </div>

          ))}

          {loading && !messages.some(
            (m) => m.from === "bot" && m.streaming
          ) && (
            <div className={`${styles.botBubble} ${styles.botBubbleThinking}`}>
              Thinking...
            </div>
          )}

          {messages.length <= 1 && !loading && (
            <div className={styles.quickChipRow}>
              {quickSuggestions.map((s, j) => (
                <button
                  key={j}
                  className={styles.chip}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

        </div>

      </div>

      <div className={styles.inputBar}>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about tasks, projects, stock..."
          className={styles.input}
          disabled={loading}
        />

        <button
          onClick={() => send()}
          className={styles.sendBtn}
          disabled={loading}
          title="Send"
        >
          <SendIcon />
        </button>

      </div>

    </div>
  );
}
