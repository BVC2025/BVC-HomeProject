import { useEffect, useRef, useState } from "react";

import API from "../services/api";


// ===================================================================
// HRAssistant — floating chat widget on the employee dashboard.
// Talks to the backend's /hr-bot/message endpoint (rule-based, no
// paid LLM). Drives the leave-application workflow + answers FAQs
// about balance / policy / history.
// ===================================================================


const STORAGE_KEY = "hr_bot_thread_v1";


function loadThread(employeeId) {

  try {

    const raw = localStorage.getItem(STORAGE_KEY + ":" + employeeId);

    if (!raw) return null;

    return JSON.parse(raw);

  } catch {

    return null;
  }
}


function saveThread(employeeId, thread) {

  try {

    localStorage.setItem(
      STORAGE_KEY + ":" + employeeId,
      JSON.stringify(thread)
    );

  } catch {
    // ignore quota errors
  }
}


function HRAssistant({ employeeId, employeeName }) {

  const [open, setOpen] = useState(false);

  const [busy, setBusy] = useState(false);

  const [input, setInput] = useState("");

  const [messages, setMessages] = useState([]);

  const [context, setContext] = useState({ state: "idle" });

  const [suggestions, setSuggestions] = useState([]);

  const scrollRef = useRef(null);

  // Restore previous thread on mount
  useEffect(() => {

    if (!employeeId) return;

    const saved = loadThread(employeeId);

    if (saved) {

      setMessages(saved.messages || []);

      setContext(saved.context || { state: "idle" });

      setSuggestions(saved.suggestions || []);

    } else {

      // Seed with a greeting from the bot
      const name = (employeeName || "").split(" ")[0] || "there";

      setMessages([
        {
          from: "bot",
          text:
            `Hi ${name}! 👋 I'm your HR assistant. I can apply leaves ` +
            `for you, check your balance, or explain the policy. ` +
            `What can I help with today?`
        }
      ]);

      setSuggestions([
        "Apply leave",
        "Show my balance",
        "Show my leave history",
        "What's the leave policy?"
      ]);
    }

  }, [employeeId, employeeName]);

  // Persist whenever the thread changes
  useEffect(() => {

    if (!employeeId) return;

    saveThread(employeeId, { messages, context, suggestions });

  }, [employeeId, messages, context, suggestions]);

  // Auto-scroll on new messages
  useEffect(() => {

    if (scrollRef.current) {

      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

  }, [messages, busy]);

  const send = async (text) => {

    if (!text?.trim()) return;

    if (busy) return;

    const userMsg = { from: "user", text };

    setMessages((m) => [...m, userMsg]);

    setInput("");

    setBusy(true);

    try {

      const res = await API.post("/hr-bot/message", {
        employee_id: employeeId,
        message: text,
        context
      });

      const data = res.data || {};

      const botMsg = {
        from: "bot",
        text: data.reply || "(no reply)"
      };

      setMessages((m) => [...m, botMsg]);

      setContext(data.context || { state: "idle" });

      setSuggestions(data.suggestions || []);

      // If the bot just submitted a leave request, surface it via the
      // notification system on the dashboard (optional — fire a
      // custom event the dashboard can listen to)
      if (data.action?.type === "leave_submitted") {

        window.dispatchEvent(new CustomEvent("hr-bot:leave-submitted", {
          detail: data.action
        }));
      }

    } catch (err) {

      setMessages((m) => [
        ...m,
        {
          from: "bot",
          text:
            "⚠️ I couldn't reach the server. Please try again — or " +
            "use the leave form below.",
          isError: true
        }
      ]);

    } finally {

      setBusy(false);
    }
  };

  const resetThread = () => {

    if (!window.confirm("Start a fresh conversation?")) return;

    localStorage.removeItem(STORAGE_KEY + ":" + employeeId);

    setMessages([]);

    setContext({ state: "idle" });

    setSuggestions([]);

    // Re-trigger the greeting effect by toggling the open state
    setOpen(false);

    setTimeout(() => setOpen(true), 50);

    const name = (employeeName || "").split(" ")[0] || "there";

    setMessages([
      {
        from: "bot",
        text: `Hi ${name}! 👋 Fresh start. How can I help?`
      }
    ]);

    setSuggestions([
      "Apply leave",
      "Show my balance",
      "Show my leave history"
    ]);
  };

  return (

    <>

      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open HR Assistant"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 1200,
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: "none",
            background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
            color: "white",
            cursor: "pointer",
            boxShadow: "0 12px 30px rgba(200,16,46,0.5)",
            fontSize: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "hrBotPulse 2.4s ease-in-out infinite"
          }}
          title="HR Assistant — apply leave, check balance, ask questions"
        >
          💬
        </button>
      )}

      <style>{`
        @keyframes hrBotPulse {
          0%, 100% { box-shadow: 0 12px 30px rgba(200,16,46,0.5); }
          50%      { box-shadow: 0 12px 30px rgba(200,16,46,0.85),
                                  0 0 0 8px rgba(200,16,46,0.18); }
        }
        @keyframes hrBotSlide {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 1200,
            width: 380,
            maxWidth: "94vw",
            height: 560,
            maxHeight: "85vh",
            background: "white",
            borderRadius: 18,
            boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "hrBotSlide 0.25s ease-out"
          }}
        >

          {/* Header */}
          <div style={{
            background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
            color: "white",
            padding: "14px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.85, letterSpacing: 1.5 }}>
                BVC24 · HR ASSISTANT
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
                Leave & Permissions
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={resetThread}
                title="New conversation"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  color: "white",
                  borderRadius: 6,
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700
                }}
              >
                ↻
              </button>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  color: "white",
                  borderRadius: 6,
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              padding: "16px 14px",
              overflowY: "auto",
              background: "#fafafa",
              display: "flex",
              flexDirection: "column",
              gap: 10
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.from === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%"
                }}
              >
                <div style={{
                  background: m.from === "user"
                    ? "linear-gradient(135deg, #C8102E, #8B0B1F)"
                    : (m.isError ? "#fef2f2" : "white"),
                  color: m.from === "user"
                    ? "white"
                    : (m.isError ? "#b91c1c" : "#0f172a"),
                  padding: "9px 13px",
                  borderRadius: m.from === "user"
                    ? "14px 14px 4px 14px"
                    : "14px 14px 14px 4px",
                  fontSize: 13,
                  lineHeight: 1.45,
                  border: m.from === "bot" ? "1px solid #e2e8f0" : "none",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word"
                }}>
                  {renderMarkdown(m.text)}
                </div>
              </div>
            ))}

            {busy && (
              <div style={{ alignSelf: "flex-start" }}>
                <div style={{
                  background: "white",
                  padding: "9px 13px",
                  borderRadius: "14px 14px 14px 4px",
                  fontSize: 13,
                  border: "1px solid #e2e8f0",
                  color: "#64748b",
                  fontStyle: "italic"
                }}>
                  thinking…
                </div>
              </div>
            )}
          </div>

          {/* Suggestion chips */}
          {suggestions.length > 0 && !busy && (
            <div style={{
              padding: "8px 14px",
              borderTop: "1px solid #e2e8f0",
              background: "white",
              display: "flex",
              gap: 6,
              flexWrap: "wrap"
            }}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  style={{
                    background: "#fef2f2",
                    color: "#8B0B1F",
                    border: "1px solid #fecaca",
                    borderRadius: 999,
                    padding: "5px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: 12,
            borderTop: "1px solid #e2e8f0",
            background: "white",
            display: "flex",
            gap: 8
          }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder='Try "I need leave tomorrow"…'
              disabled={busy}
              style={{
                flex: 1,
                padding: "9px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                fontSize: 13,
                outline: "none",
                fontFamily: "inherit"
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              style={{
                background: busy || !input.trim()
                  ? "#94a3b8"
                  : "linear-gradient(135deg, #C8102E, #8B0B1F)",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "9px 18px",
                cursor: busy || !input.trim() ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: 13
              }}
            >
              ➤
            </button>
          </div>

        </div>
      )}

    </>
  );
}


// =================================================================
// Tiny inline markdown — supports **bold** + line breaks.
// (Full markdown would require a library; this covers the bot's
// limited formatting needs.)
// =================================================================

function renderMarkdown(text) {

  if (!text) return null;

  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, i) => {

    if (/^\*\*[^*]+\*\*$/.test(part)) {

      return <b key={i}>{part.slice(2, -2)}</b>;
    }

    return <span key={i}>{part}</span>;
  });
}


export default HRAssistant;
