import { useEffect, useRef, useState } from "react";

import API from "../services/api";
import styles from "./HRAssistant.module.css";


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

  // Resolve bubble class for a message
  const bubbleClass = (m) => {
    if (m.from === "user") return `${styles.msgBubble} ${styles.msgBubbleUser}`;
    if (m.isError)         return `${styles.msgBubble} ${styles.msgBubbleError}`;
    return `${styles.msgBubble} ${styles.msgBubbleBot}`;
  };

  return (

    <>

      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open HR Assistant"
          className={styles.fab}
          title="HR Assistant — apply leave, check balance, ask questions"
        >
          💬
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className={styles.panel}>

          {/* Header */}
          <div className={styles.header}>
            <div>
              <div className={styles.headerMeta}>
                BVC24 · HR ASSISTANT
              </div>
              <div className={styles.headerTitle}>
                Leave & Permissions
              </div>
            </div>
            <div className={styles.headerActions}>
              <button
                onClick={resetThread}
                title="New conversation"
                className={styles.headerBtn}
              >
                ↻
              </button>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                className={styles.headerCloseBtn}
              >
                ×
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className={styles.messages}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`${styles.msgWrapper} ${m.from === "user" ? styles.user : styles.bot}`}
              >
                <div className={bubbleClass(m)}>
                  {renderMarkdown(m.text)}
                </div>
              </div>
            ))}

            {busy && (
              <div className={styles.thinking}>
                <div className={styles.thinkingBubble}>
                  thinking…
                </div>
              </div>
            )}
          </div>

          {/* Suggestion chips */}
          {suggestions.length > 0 && !busy && (
            <div className={styles.suggestions}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  className={styles.chip}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className={styles.inputRow}>
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
              className={styles.input}
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              className={styles.sendBtn}
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
