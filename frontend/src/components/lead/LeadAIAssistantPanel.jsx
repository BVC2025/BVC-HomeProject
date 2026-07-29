import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRagChat } from "../../hooks/useRagChat";
import styles from "./LeadAIAssistantPanel.module.css";

// Slide-in drawer (not a full modal, so the lead table stays visible/usable
// behind it) hardcoded to module_code="lead", posting to /rag/chat/stream.
// Purely additive — no existing state/handler on ManualLeadManagement.jsx
// is touched to wire this in, just one new button.
export default function LeadAIAssistantPanel({ open, onClose }) {
  const { messages, send, loading } = useRagChat("lead", { verbose: false });
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  if (!open) return null;

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text);
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Lead AI Assistant</div>
            <div className={styles.subtitle}>Ask about the lead process, SOPs & FAQs</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        <div ref={scrollRef} className={styles.messages}>
          {messages.length === 0 && (
            <div className={styles.hint}>
              Try: "How are IndiaMART leads assigned?" or "What's the SOP for a new manual lead?"
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.from === "user" ? styles.userBubble : (m.error ? styles.errorBubble : styles.botBubble)}>
              {m.error ? `⚠️ ${m.error}` : m.text}
              {m.streaming && <span className={styles.cursor} />}
            </div>
          ))}
        </div>

        <div className={styles.inputBar}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask a question…"
            disabled={loading}
          />
          <button className={styles.sendBtn} onClick={handleSend} disabled={loading}>
            {loading ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
