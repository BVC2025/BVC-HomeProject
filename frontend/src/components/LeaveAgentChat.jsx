// =====================================================================
// LeaveAgentChat — conversational UI for the AI Leave Agent.
//
// Wraps POST /leave-agent/chat. Renders messages, quick-reply chips,
// supports voice input via Web Speech API, auto-resumes the active
// session on mount.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";


export default function LeaveAgentChat({ employeeId, onLeaveSubmitted }) {

  const [messages, setMessages] = useState([
    {
      role: "agent",
      text:
        "Hi! I'm your HR assistant. I can help with leave, attendance, " +
        "payslips, holidays, your profile, or company policies. " +
        "Just ask in plain English — for example: \"I need leave tomorrow\", " +
        "\"send my latest payslip\", or \"when's the next holiday?\".",
    },
  ]);
  const [input, setInput]       = useState("");
  const [sending, setSending]   = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [collected, setCollected] = useState({});
  const [state, setState]       = useState("COLLECTING");
  const [suggestions, setSuggestions] = useState([
    "I need leave tomorrow",
    "How many leaves do I have?",
    "Send my latest payslip",
    "Next holiday",
    "Who's my manager?",
  ]);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");

  const recRef = useRef(null);
  const scrollerRef = useRef(null);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async (preset) => {
    const text = (preset || input).trim();
    if (!text || sending) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);
    setError("");

    try {
      // Unified HR Assistant — handles leave, attendance, payroll,
      // employee info, HR policy, and holidays through one endpoint.
      const res = await API.post("/hr-assistant/chat", {
        EMPLOYEE_ID: employeeId,
        MESSAGE: text,
        SESSION_ID: sessionId,
      });
      const d = res.data || {};
      setMessages((m) => [...m, {
        role: "agent",
        text: d.message || "(no reply)",
        state: d.state,
        intent: d.intent,
        leaveRequestId: d?.data?.leave_request_id,
      }]);
      setSessionId(d.session_id || null);
      // The unified endpoint doesn't track collected fields the same way
      // — only the leave sub-flow does, via session_id.
      setCollected({});
      setState(d.state || "COLLECTING");
      setSuggestions(Array.isArray(d.suggestions) && d.suggestions.length
        ? d.suggestions : []);

      // If a leave request was just submitted, bubble up so the
      // "My leave requests" panel reloads.
      if (d?.data?.leave_request_id) {
        onLeaveSubmitted?.(d.data.leave_request_id);
      }
    } catch (e) {
      setError(e?.response?.data?.detail || "The agent is offline right now.");
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    try {
      await API.post(`/leave-agent/reset?employee_id=${encodeURIComponent(employeeId)}`);
    } catch {/* ignore */}
    setMessages([{
      role: "agent",
      text: "Started fresh. What would you like to do?",
    }]);
    setSessionId(null);
    setCollected({});
    setState("COLLECTING");
    setSuggestions([
      "I need leave tomorrow",
      "How many leaves do I have?",
      "Status of my last leave",
    ]);
  };

  // ---- Voice input ----
  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      if (transcript) {
        setInput(transcript);
        send(transcript);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  };

  // ---- UI ----
  return (
    <div style={{
      background: "white",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      display: "flex",
      flexDirection: "column",
      maxHeight: "min(calc(100dvh - 180px), calc(100vh - 180px))",
      overflow: "hidden",
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
    }}>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
        color: "white",
        padding: "14px 18px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div>
          <div style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 2,
            color: BVC_GOLD,
            textTransform: "uppercase",
          }}>
            BVC24 &middot; AI assistant
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>
            HR Assistant
          </div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
            Leave · Attendance · Payroll · Holidays · Policies · Profile
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          title="Start a fresh conversation"
          style={{
            background: "rgba(255,255,255,0.15)",
            color: "white",
            border: "none",
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          New
        </button>
      </div>

      {/* Collected summary (when we have data) */}
      {hasCollected(collected) && (
        <div style={{
          padding: "10px 16px",
          background: "#fafbfc",
          borderBottom: "1px solid #f1f5f9",
          fontSize: 12,
          color: "#475569",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
        }}>
          {collected.leave_type && <Tag label="Type"   value={collected.leave_type} />}
          {collected.start_date && <Tag label="From"   value={collected.start_date} />}
          {collected.end_date   && <Tag label="To"     value={collected.end_date} />}
          {collected.days != null && <Tag label="Days" value={String(collected.days)} />}
          {collected.reason     && <Tag label="Reason" value={collected.reason} />}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          padding: 14,
          minHeight: 240,
          overflowY: "auto",
          background: "#fafbfc",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {sending && (
          <div style={{
            alignSelf: "flex-start",
            fontSize: 12,
            color: "#94a3b8",
            fontStyle: "italic",
          }}>
            Thinking...
          </div>
        )}
        {error && (
          <div style={{
            alignSelf: "flex-start",
            padding: "6px 10px",
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontSize: 12,
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Quick-reply chips */}
      {suggestions.length > 0 && state !== "EXECUTED" && state !== "CANCELLED" && (
        <div style={{
          padding: "8px 12px",
          borderTop: "1px solid #f1f5f9",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          background: "white",
        }}>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={sending}
              style={{
                padding: "5px 10px",
                background: "white",
                color: BVC_DARK,
                border: `1px solid ${BVC_RED}`,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: sending ? "default" : "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div style={{
        padding: 10,
        borderTop: "1px solid #f1f5f9",
        display: "flex",
        gap: 6,
        background: "white",
      }}>
        <button
          type="button"
          onClick={toggleVoice}
          title={listening ? "Stop recording" : "Voice input"}
          style={{
            width: 40,
            height: 40,
            border: "1px solid " + (listening ? BVC_RED : "#cbd5e1"),
            background: listening ? BVC_RED : "white",
            color: listening ? "white" : "#475569",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.2"
               strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder='Ask anything — leave, payslip, holidays, policies...'
          disabled={sending}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            fontSize: 16,
            fontFamily: "inherit",
          }}
        />

        <button
          type="button"
          onClick={() => send()}
          disabled={sending || !input.trim()}
          style={{
            padding: "9px 16px",
            background: sending || !input.trim() ? "#cbd5e1" : BVC_RED,
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 800,
            cursor: sending || !input.trim() ? "default" : "pointer",
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}


function Bubble({ role, text }) {
  const isUser = role === "user";
  return (
    <div style={{
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: "85%",
      padding: "10px 14px",
      borderRadius: 12,
      background: isUser ? BVC_DARK : "white",
      color: isUser ? "white" : "#0f172a",
      border: isUser ? "none" : "1px solid #e2e8f0",
      fontSize: 13,
      lineHeight: 1.5,
      whiteSpace: "pre-wrap",
    }}>
      {text}
    </div>
  );
}


function Tag({ label, value }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "3px 10px",
      background: "white",
      border: "1px solid #e2e8f0",
      borderRadius: 999,
      fontSize: 11,
    }}>
      <span style={{ color: "#94a3b8", fontWeight: 700, letterSpacing: 0.3 }}>
        {label.toUpperCase()}
      </span>
      <span style={{ color: "#0f172a", fontWeight: 700 }}>{value}</span>
    </span>
  );
}


function hasCollected(c) {
  return c && (c.leave_type || c.start_date || c.end_date || c.days || c.reason);
}
