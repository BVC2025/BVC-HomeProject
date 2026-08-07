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
import styles from "./LeaveChatbot.module.css";


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

    <section className={styles.section}>

      {/* ============ Header ============ */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        className={styles.header}
      >
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>
            🤖
          </span>
          <div>
            <div className={styles.headerMeta}>
              BVC24 · AI Leave Assistant
            </div>
            <div className={styles.headerTitle}>
              Apply for leave by chat — no forms
            </div>
          </div>
        </div>
        <div className={styles.headerToggle}>
          {collapsed ? "▼ Open" : "▲ Hide"}
        </div>
      </div>

      {!collapsed && (

        <>
          {/* ============ Message stream ============ */}
          <div
            ref={scrollRef}
            className={styles.stream}
          >
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} onChip={handleChip} />
            ))}

            {busy && (
              <div className={styles.thinking}>
                Thinking…
              </div>
            )}

            {error && (
              <div className={styles.errorBox}>
                {error}
              </div>
            )}

            {submitted && (
              <div className={styles.successBox}>
                <div className={styles.successTitle}>
                  ✓ Leave #{submitted.request_id} submitted
                </div>
                <div className={styles.successDetail}>
                  {submitted.leave_type} · {submitted.start_date}
                  {submitted.end_date && submitted.end_date !== submitted.start_date && ` → ${submitted.end_date}`}
                  {" "}· status: <strong>{submitted.status}</strong>
                </div>
              </div>
            )}
          </div>

          {/* ============ Composer ============ */}
          <div className={styles.composer}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy || submitting}
              placeholder='Try: "casual leave tomorrow for family function"'
              className={styles.composerInput}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || busy || submitting}
              className={styles.composerSendBtn}
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
    <div className={`${styles.bubbleRow} ${isBot ? styles.bot : styles.user}`}>
      <div className={`${styles.bubble} ${isBot ? styles.bubbleBot : styles.bubbleUser}`}>
        <div className={styles.bubbleText}>
          {renderInlineBold(msg.text)}
        </div>

        {/* Validation summary chip row (when ready_to_submit + balance shown) */}
        {isBot && msg.ready && msg.validation?.balance && (
          <div className={styles.validationRow}>
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
          <div className={styles.chipRow}>
            {msg.suggestions.map((s) => {

              const isPrimary = s === "Confirm & Submit";

              const isDanger  = s === "Cancel";

              const chipCls = isPrimary
                ? styles.chipPrimary
                : isDanger
                  ? styles.chipDanger
                  : styles.chipNeutral;

              return (
                <button
                  key={s}
                  onClick={() => onChip(s)}
                  className={chipCls}
                >
                  {isPrimary ? "✓ " : ""}{s}
                </button>
              );
            })}
          </div>
        )}

        {/* Timestamp */}
        <div className={`${styles.timestamp} ${isBot ? styles.timestampBot : styles.timestampUser}`}>
          {msg.ts?.toLocaleTimeString?.("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
        </div>
      </div>
    </div>
  );
}


function SummaryPill({ label, value, color }) {

  return (
    <span
      className={styles.summaryPill}
      style={{
        background: color + "15",
        color
      }}
    >
      <span className={styles.summaryPillLabel}>{label}:</span>
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
