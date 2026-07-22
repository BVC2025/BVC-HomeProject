import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, PMSelect, PMButton } from "../components/pm";
import { aiModuleService } from "../services/aiModuleService";
import { useRagChat } from "../hooks/useRagChat";
import styles from "./AIPlatformShared.module.css";

export default function AIPlaygroundPage() {
  const [modules, setModules] = useState([]);
  const [moduleCode, setModuleCode] = useState("");
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    aiModuleService.getAll().then((res) => {
      const rows = res.data || [];
      setModules(rows);
      const active = rows.find((m) => m.IS_ACTIVE);
      if (active) setModuleCode(active.MODULE_CODE);
    }).catch(() => {});
  }, []);

  const { messages, send, loading } = useRagChat(moduleCode, { verbose: true });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const moduleOptions = useMemo(() => modules.map((m) => ({ value: m.MODULE_CODE, label: m.MODULE_NAME })), [modules]);

  const lastBot = [...messages].reverse().find((m) => m.from === "bot");

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text);
  }, [input, send]);

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="AI Playground"
        subtitle="Test any AI Assistant before rolling it out — see retrieved chunks, confidence, and token usage"
      />

      <div className={styles.playgroundLayout}>
        <div className={styles.chatPane}>
          <div className={styles.chatModuleBar}>
            <PMSelect
              options={moduleOptions}
              value={moduleCode}
              onChange={setModuleCode}
              placeholder="Select AI module"
              style={{ minWidth: 240 }}
            />
          </div>

          <div ref={scrollRef} className={styles.chatMessages}>
            {messages.length === 0 && (
              <div className={styles.muted}>Ask a question to test this module's knowledge base.</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.from === "user" ? styles.userBubble : (m.error ? styles.errorBubble : styles.botBubble)}>
                {m.error ? `⚠️ ${m.error}` : m.text}
                {m.streaming && <span className={styles.cursor} />}
              </div>
            ))}
          </div>

          <div className={styles.chatInputBar}>
            <input
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask a question…"
              disabled={loading || !moduleCode}
            />
            <PMButton onClick={handleSend} disabled={loading || !moduleCode}>
              {loading ? "Asking…" : "Send"}
            </PMButton>
          </div>
        </div>

        <div className={styles.sidePanel}>
          <div className={styles.sidePanelTitle}>Response Details</div>

          {!lastBot ? (
            <div className={styles.muted}>Ask a question to see retrieval details here.</div>
          ) : (
            <>
              {lastBot.confidence != null && (
                <div className={styles.metricRow}>
                  <span>Confidence</span>
                  <strong>{(lastBot.confidence * 100).toFixed(1)}%</strong>
                </div>
              )}
              {lastBot.usage?.response_time != null && (
                <div className={styles.metricRow}>
                  <span>Response Time</span>
                  <strong>{lastBot.usage.response_time}s</strong>
                </div>
              )}
              {lastBot.usage?.total_tokens != null && (
                <div className={styles.metricRow}>
                  <span>Tokens (P/C/T)</span>
                  <strong>{lastBot.usage.prompt_tokens}/{lastBot.usage.completion_tokens}/{lastBot.usage.total_tokens}</strong>
                </div>
              )}
              {lastBot.usage?.model_name && (
                <div className={styles.metricRow}>
                  <span>Model</span>
                  <strong>{lastBot.usage.model_name}</strong>
                </div>
              )}

              <div className={styles.sidePanelTitle} style={{ marginTop: "var(--sp-3)" }}>
                Retrieved Chunks ({lastBot.chunks?.length || 0})
              </div>
              {(lastBot.chunks || []).length === 0 ? (
                <div className={styles.muted}>No matching documents found for this question.</div>
              ) : (
                lastBot.chunks.map((c, i) => (
                  <div key={i} className={styles.chunkCard}>
                    <div className={styles.chunkTitle}>
                      {c.document_title} · {(c.score * 100).toFixed(1)}%
                    </div>
                    <div className={styles.chunkText}>{c.chunk_text}</div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
