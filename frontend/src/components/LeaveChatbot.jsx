// =====================================================================
// LeaveChatbot — natural-language leave request panel
//
// Mounted on the Employee Portal alongside (NOT replacing) the existing
// Apply for Leave form. Multi-turn chat:
//   1. employee types in plain English
//   2. backend parses + validates against company policy
//   3. when all fields are present → "Confirm & Submit"
//   4. on confirm → calls existing POST /leave/apply (same endpoint the
//      form uses) → HR email + leave dashboard update happens via that
//      existing workflow, untouched.
// =====================================================================

import { useEffect, useRef, useState } from "react";

import API from "../services/api";


const BVC = {
  PRIMARY: "#C8102E",
  DARK:    "#8B0B1F",
  GOLD:    "#F4B324",
  TINT:    "#fef2f2",
  BG:      "#fff7ed",
  TEXT:    "#0f172a",
  MUTED:   "#64748b"
};


export default function LeaveChatbot({ employeeId, onLeaveSubmitted }) {

  const [messages, setMessages] = useState([]);
  // [{ role: "bot"|"user", text, ts, suggestions?, ready?, validation? }]

  const [input, setInput] = useState("");

  const [state, setState] = useState({});

  const [employeeUuid, setEmployeeUuid] = useState(null);

  const [busy, setBusy] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [submitted, setSubmitted] = useState(null);
  // { request_id, status, leave_type, ... } after successful submit

  const [error, setError] = useState("");

  const [collapsed, setCollapsed] = useState(false);

  const scrollRef = useRef(null);

  const inputRef = useRef(null);

  // ---- Bootstrap with greeting ----
  useEffect(() => {

    if (!employeeId) return;

    API.get(`/leave-chatbot/greeting/${encodeURIComponent(employeeId)}`)

      .then((r) => {

        setEmployeeUuid(r.data?.employee_uuid || null);

        setMessages([{
          role: "bot",
          text: r.data?.greeting || "Hi! I'm your leave assistant.",
          ts:   new Date(),
          suggestions: r.data?.suggestions || []
        }]);

      })

      .catch(() => {

        setMessages([{
          role: "bot",
          text: "Hi! I'm your leave assistant. Try: *'casual leave tomorrow for family function'*",
          ts:   new Date(),
          suggestions: ["Casual leave tomorrow", "Sick leave today", "Earned leave next monday"]
        }]);
      });

  }, [employeeId]);

  // Auto-scroll on new message
  useEffect(() => {

    if (scrollRef.current) {

      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

  }, [messages, busy]);

  // ---- Send a chat turn ----
  const send = async (text) => {

    const message = (text ?? input).trim();

    if (!message || busy) return;

    setInput("");

    setError("");

    // Show user message
    setMessages((m) => [...m, { role: "user", text: message, ts: new Date() }]);

    setBusy(true);

    try {

      const res = await API.post("/leave-chatbot/message", {
        employee_id: employeeId,
        message,
        state
      });

      const d = res.data || {};

      setState(d.state || {});

      if (d.employee_uuid && !employeeUuid) setEmployeeUuid(d.employee_uuid);

      setMessages((m) => [...m, {
        role: "bot",
        text: d.reply || "(no reply)",
        ts:   new Date(),
        suggestions: d.suggestions || [],
        ready: !!d.ready_to_submit,
        validation: d.validation || null,
        snapshotState: d.state || {}
      }]);

    } catch (e) {

      setError(e?.response?.data?.detail || "Sorry, something went wrong. Try again.");

    } finally {

      setBusy(false);

      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // ---- Click a suggestion chip ----
  const handleChip = (label) => {

    if (label === "Confirm & Submit") {

      submitFinal();

      return;
    }

    if (label === "Cancel") {

      setState({});

      setMessages((m) => [...m, {
        role: "bot",
        text: "Okay — discarded. Start a new one whenever you're ready.",
        ts:   new Date(),
        suggestions: ["Casual leave tomorrow", "Sick leave today"]
      }]);

      return;
    }

    send(label);
  };

  // ---- Final submit → calls existing /leave/apply endpoint ----
  const submitFinal = async () => {

    if (submitting) return;

    if (!state.leave_type || !state.start_date || !state.end_date) {

      setError("Missing required fields. Tell me more before confirming.");

      return;
    }

    setSubmitting(true);

    setError("");

    try {

      const payload = {
        EMPLOYEE_ID: employeeUuid || employeeId,
        LEAVE_TYPE:  state.leave_type,
        START_DATE:  state.start_date,
        END_DATE:    state.end_date,
        REASON:      state.reason || "",
        HALF_DAY:    !!state.is_half_day
      };

      const res = await API.post("/leave/apply", payload);

      const lr = res.data?.leave_request || res.data || {};

      setSubmitted({
        request_id: lr.ID,
        status:     lr.STATUS || "PENDING_APPROVAL",
        leave_type: payload.LEAVE_TYPE,
        start_date: payload.START_DATE,
        end_date:   payload.END_DATE,
        days:       lr.DAYS
      });

      setMessages((m) => [...m, {
        role: "bot",
        text: (
          `✓ **Submitted!** Request **#${lr.ID || "—"}** created.\n\n` +
          `Status: **${lr.STATUS || "PENDING_APPROVAL"}**\n` +
          `📧 HR has been notified by email and your manager can approve from there.\n` +
          `📋 It also appears in the Leave History panel above — refreshing now.`
        ),
        ts:   new Date(),
        suggestions: ["Apply another leave", "Done"]
      }]);

      setState({});

      // Tell parent so the existing Leave History panel reloads
      onLeaveSubmitted?.(lr);

    } catch (e) {

      const detail = e?.response?.data?.detail || "Submission failed.";

      setError(detail);

      setMessages((m) => [...m, {
        role: "bot",
        text: `⚠ Couldn't submit: ${detail}\n\nWhat would you like to change?`,
        ts:   new Date(),
        suggestions: ["Change date", "Change reason", "Cancel"]
      }]);

    } finally {

      setSubmitting(false);
    }
  };

  const onKeyDown = (e) => {

    if (e.key === "Enter" && !e.shiftKey) {

      e.preventDefault();

      send();
    }
  };

  if (!employeeId) return null;

  return (

    <section style={{
      background: "white",
      border: `1px solid ${BVC.PRIMARY}33`,
      borderRadius: 14,
      marginBottom: 18,
      boxShadow: "0 4px 12px rgba(200,16,46,0.08)",
      overflow: "hidden"
    }}>

      {/* ============ Header ============ */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          padding: "14px 18px",
          background: `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DARK})`,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 38, height: 38, borderRadius: 10,
            background: "rgba(255,255,255,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20
          }}>
            🤖
          </span>
          <div>
            <div style={{
              fontSize: 11, letterSpacing: 1.4, fontWeight: 800,
              opacity: 0.85, textTransform: "uppercase"
            }}>
              BVC24 · AI Leave Assistant
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2, letterSpacing: -0.2 }}>
              Apply for leave by chat — no forms
            </div>
          </div>
        </div>
        <div style={{
          background: "rgba(255,255,255,0.18)",
          padding: "4px 12px", borderRadius: 999,
          fontSize: 11, fontWeight: 800
        }}>
          {collapsed ? "▼ Open" : "▲ Hide"}
        </div>
      </div>

      {!collapsed && (

        <>
          {/* ============ Message stream ============ */}
          <div
            ref={scrollRef}
            style={{
              padding: 16,
              maxHeight: 420,
              minHeight: 220,
              overflowY: "auto",
              background: "#fafafa"
            }}
          >
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} onChip={handleChip} />
            ))}

            {busy && (
              <div style={{ color: BVC.MUTED, fontSize: 12, fontStyle: "italic", padding: 8 }}>
                Thinking…
              </div>
            )}

            {error && (
              <div style={{
                marginTop: 8,
                padding: "8px 12px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                color: "#991b1b",
                fontSize: 12
              }}>
                {error}
              </div>
            )}

            {submitted && (
              <div style={{
                marginTop: 12,
                padding: "12px 14px",
                background: "#dcfce7",
                border: "1px solid #86efac",
                borderRadius: 10,
                color: "#15803d",
                fontSize: 13
              }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>
                  ✓ Leave #{submitted.request_id} submitted
                </div>
                <div style={{ fontSize: 12 }}>
                  {submitted.leave_type} · {submitted.start_date}
                  {submitted.end_date && submitted.end_date !== submitted.start_date && ` → ${submitted.end_date}`}
                  {" "}· status: <strong>{submitted.status}</strong>
                </div>
              </div>
            )}
          </div>

          {/* ============ Composer ============ */}
          <div style={{
            padding: "10px 12px",
            borderTop: "1px solid #e2e8f0",
            background: "white",
            display: "flex",
            gap: 8
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy || submitting}
              placeholder='Try: "casual leave tomorrow for family function"'
              style={{
                flex: 1,
                padding: "10px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none"
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || busy || submitting}
              style={{
                background: !input.trim() ? "#e2e8f0"
                  : `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DARK})`,
                color: !input.trim() ? "#94a3b8" : "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 800,
                cursor: !input.trim() ? "default" : "pointer",
                letterSpacing: 0.3
              }}
            >
              {submitting ? "Submitting…" : busy ? "…" : "Send"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}


// =====================================================================
// Sub-components
// =====================================================================

function Bubble({ msg, onChip }) {

  const isBot = msg.role === "bot";

  return (
    <div style={{
      display: "flex",
      justifyContent: isBot ? "flex-start" : "flex-end",
      marginBottom: 10
    }}>
      <div style={{
        maxWidth: "82%",
        background: isBot ? "white" : `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DARK})`,
        color:      isBot ? BVC.TEXT : "white",
        border:     isBot ? "1px solid #e2e8f0" : "none",
        borderRadius: isBot ? "10px 10px 10px 2px" : "10px 10px 2px 10px",
        padding: "10px 14px",
        fontSize: 13,
        lineHeight: 1.5,
        boxShadow: isBot ? "0 1px 2px rgba(0,0,0,0.04)" : "0 4px 12px rgba(200,16,46,0.20)"
      }}>
        <div style={{ whiteSpace: "pre-wrap" }}>
          {renderInlineBold(msg.text)}
        </div>

        {/* Validation summary chip row (when ready_to_submit + balance shown) */}
        {isBot && msg.ready && msg.validation?.balance && (
          <div style={{
            marginTop: 8,
            display: "flex", gap: 6, flexWrap: "wrap"
          }}>
            <SummaryPill
              label="Balance after"
              value={`${msg.validation.balance.remaining_after} ${msg.validation.balance.type}`}
              color="#10b981"
            />
            <SummaryPill
              label="Days"
              value={msg.validation.days}
              color="#3b82f6"
            />
          </div>
        )}

        {/* Suggestion chips */}
        {isBot && msg.suggestions && msg.suggestions.length > 0 && (
          <div style={{
            marginTop: 10,
            display: "flex",
            gap: 6,
            flexWrap: "wrap"
          }}>
            {msg.suggestions.map((s) => {

              const isPrimary = s === "Confirm & Submit";

              const isDanger  = s === "Cancel";

              return (
                <button
                  key={s}
                  onClick={() => onChip(s)}
                  style={{
                    background: isPrimary
                      ? `linear-gradient(135deg, ${BVC.PRIMARY}, ${BVC.DARK})`
                      : isDanger ? "white" : "white",
                    color: isPrimary ? "white" : isDanger ? "#991b1b" : "#475569",
                    border: isPrimary ? "none" : `1px solid ${isDanger ? "#fecaca" : "#cbd5e1"}`,
                    padding: "5px 12px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                    letterSpacing: 0.3,
                    boxShadow: isPrimary ? "0 4px 12px rgba(200,16,46,0.25)" : "none"
                  }}
                >
                  {isPrimary ? "✓ " : ""}{s}
                </button>
              );
            })}
          </div>
        )}

        {/* Timestamp */}
        <div style={{
          fontSize: 9,
          opacity: isBot ? 0.5 : 0.7,
          marginTop: 6,
          fontFamily: "ui-monospace, monospace",
          letterSpacing: 0.4
        }}>
          {msg.ts?.toLocaleTimeString?.("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
        </div>
      </div>
    </div>
  );
}


function SummaryPill({ label, value, color }) {

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      background: color + "15",
      color,
      padding: "3px 10px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.4
    }}>
      <span style={{ opacity: 0.7 }}>{label}:</span>
      <span>{value}</span>
    </span>
  );
}


// Render **bold** markers inline since we're not pulling in a markdown lib
function renderInlineBold(text) {

  if (!text) return null;

  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);

  return parts.map((p, i) => {

    if (p.startsWith("**") && p.endsWith("**")) {

      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }

    return <span key={i}>{p}</span>;
  });
}
