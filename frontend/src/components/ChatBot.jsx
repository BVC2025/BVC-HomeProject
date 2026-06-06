import { useState, useEffect, useRef } from "react";
import API from "../services/api";


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


  // ---- Styles (inline so this drops in without CSS edits) ----

  const bubbleStyle = {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    width: "60px",
    height: "60px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
    color: "white",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(37, 99, 235, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    transition: "transform 0.2s ease"
  };

  const panelStyle = {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    width: "380px",
    maxWidth: "92vw",
    height: "560px",
    maxHeight: "82vh",
    background: "white",
    borderRadius: "16px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.22)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    zIndex: 9999,
    fontFamily: "Segoe UI, Arial, sans-serif"
  };

  const headerStyle = {
    background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
    color: "white",
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between"
  };

  const bodyStyle = {
    flex: 1,
    overflowY: "auto",
    padding: "14px",
    background: "#f8fafc"
  };

  const inputBarStyle = {
    borderTop: "1px solid #e5e7eb",
    padding: "10px 12px",
    display: "flex",
    gap: "8px",
    background: "white"
  };

  const inputStyle = {
    flex: 1,
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "9px 12px",
    fontSize: "14px",
    outline: "none",
    fontFamily: "inherit"
  };

  const sendBtnStyle = {
    background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
    color: "white",
    border: "none",
    borderRadius: "10px",
    padding: "0 14px",
    cursor: loading ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: loading ? 0.6 : 1
  };

  const userBubbleStyle = {
    background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
    color: "white",
    padding: "10px 14px",
    borderRadius: "14px 14px 4px 14px",
    maxWidth: "78%",
    fontSize: "14px",
    lineHeight: 1.45,
    alignSelf: "flex-end",
    whiteSpace: "pre-wrap"
  };

  const botBubbleStyle = {
    background: "white",
    color: "#0f172a",
    padding: "10px 14px",
    borderRadius: "14px 14px 14px 4px",
    maxWidth: "85%",
    fontSize: "14px",
    lineHeight: 1.5,
    alignSelf: "flex-start",
    border: "1px solid #e5e7eb",
    whiteSpace: "pre-wrap",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
  };

  const itemRowStyle = {
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "6px 10px",
    marginTop: "6px",
    fontSize: "13px",
    display: "flex",
    justifyContent: "space-between",
    gap: "8px"
  };

  const chipStyle = {
    background: "#fef2f2",
    color: "#8B0B1F",
    border: "1px solid #fecaca",
    padding: "5px 11px",
    borderRadius: "999px",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "inherit"
  };


  if (!open) {

    return (
      <button
        style={bubbleStyle}
        onClick={() => setOpen(true)}
        title="ERP Assistant"
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        <BotIcon />
      </button>
    );
  }


  return (
    <div style={panelStyle}>

      <div style={headerStyle}>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>

          <div style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <BotIcon />
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: "14px" }}>
              ERP Assistant
            </div>
            <div style={{ fontSize: "11px", opacity: 0.85 }}>
              Always free · No API cost
            </div>
          </div>

        </div>

        <button
          onClick={() => setOpen(false)}
          style={{
            background: "transparent",
            border: "none",
            color: "white",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center"
          }}
          title="Close"
        >
          <CloseIcon />
        </button>

      </div>

      <div ref={scrollRef} style={bodyStyle}>

        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px"
        }}>

          {messages.map((m, i) => (

            <div
              key={i}
              style={
                m.from === "user"
                  ? userBubbleStyle
                  : botBubbleStyle
              }
            >

              {/* Source badge — small chip showing rules vs gemini */}
              {m.from === "bot" && m.source && (
                <div style={{ marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: 999,
                      background:
                        m.source === "gemini"
                          ? "linear-gradient(90deg,#C8102E,#F4B324)"
                          : "#e2e8f0",
                      color:
                        m.source === "gemini" ? "#fff" : "#475569"
                    }}
                  >
                    {m.source === "gemini"
                      ? "✨ Gemini AI"
                      : "⚡ Rule-based"}
                  </span>
                </div>
              )}

              {/* Tool-call breadcrumbs */}
              {m.from === "bot" && m.tools && m.tools.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {m.tools.map((tc, k) => (
                    <div
                      key={k}
                      style={{
                        fontSize: 11,
                        color: "#6366f1",
                        background: "#eef2ff",
                        border: "1px solid #c7d2fe",
                        borderRadius: 8,
                        padding: "4px 10px",
                        marginBottom: 4,
                        fontFamily: "ui-monospace, monospace"
                      }}
                    >
                      🔧 {tc.name}
                      {tc.args && Object.keys(tc.args).length > 0 && (
                        <span style={{ opacity: 0.65, marginLeft: 4 }}>
                          ({Object.entries(tc.args)
                            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                            .join(", ")})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ whiteSpace: "pre-wrap" }}>
                {m.reply}
                {m.streaming && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 14,
                      background: "#6366f1",
                      marginLeft: 2,
                      verticalAlign: "middle",
                      animation: "bvcChatCursor 0.9s steps(2) infinite"
                    }}
                  />
                )}
              </div>

              {m.items && m.items.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  {m.items.map((it, j) => (
                    <div key={j} style={itemRowStyle}>
                      <span style={{ fontWeight: 600 }}>{it.label}</span>
                      <span style={{ color: "#64748b" }}>
                        {it.value != null ? it.value : it.meta}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {m.suggestions && m.suggestions.length > 0 && (
                <div style={{
                  marginTop: "10px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px"
                }}>
                  {m.suggestions.map((s, j) => (
                    <button
                      key={j}
                      style={chipStyle}
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

            </div>

          ))}

          <style>{`
            @keyframes bvcChatCursor {
              0%, 100% { opacity: 1; }
              50% { opacity: 0; }
            }
          `}</style>

          {loading && !messages.some(
            (m) => m.from === "bot" && m.streaming
          ) && (
            <div style={{ ...botBubbleStyle, fontStyle: "italic", color: "#64748b" }}>
              Thinking...
            </div>
          )}

          {messages.length <= 1 && !loading && (
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              marginTop: "4px"
            }}>
              {quickSuggestions.map((s, j) => (
                <button
                  key={j}
                  style={chipStyle}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

        </div>

      </div>

      <div style={inputBarStyle}>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about tasks, projects, stock..."
          style={inputStyle}
          disabled={loading}
        />

        <button
          onClick={() => send()}
          style={sendBtnStyle}
          disabled={loading}
          title="Send"
        >
          <SendIcon />
        </button>

      </div>

    </div>
  );
}
