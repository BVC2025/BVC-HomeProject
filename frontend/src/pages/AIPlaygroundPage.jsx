import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, PMSelect, PMButton } from "../components/pm";
import { aiModuleService } from "../services/aiModuleService";
import { useRagChat } from "../hooks/useRagChat";
import { useSpeech } from "../hooks/useSpeech";
import MicIcon from "../assets/Icons/mike.webp";
import styles from "./AIPlatformShared.module.css";

const STT_LANGUAGES = [
  { code: "en-IN", label: "EN" },
  { code: "ta-IN", label: "TA" },
];

const TTS_MODES = [
  { code: "auto", label: "Auto" },
  { code: "en", label: "English" },
  { code: "ta", label: "Tamil" },
];

export default function AIPlaygroundPage() {
  const [modules, setModules] = useState([]);
  const [moduleCode, setModuleCode] = useState("");
  const [input, setInput] = useState("");
  const [sttLang, setSttLang] = useState("en-IN");
  const [ttsLangMode, setTtsLangMode] = useState("auto");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const scrollRef = useRef(null);
  const fetchedRef = useRef(false);
  const spokenIndexRef = useRef(-1);

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

  const handleFinalTranscript = useCallback((text) => {
    setInput(text);
  }, []);

  const speech = useSpeech({ sttLang, ttsLangMode, onFinalResult: handleFinalTranscript });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Speak each completed bot reply exactly once (guarded by message index,
  // not content, so it survives the chunk-by-chunk re-renders while
  // streaming — the effect re-runs every chunk but only acts once
  // `streaming` flips to false).
  useEffect(() => {
    if (!autoSpeak) return;
    const idx = messages.length - 1;
    const last = messages[idx];
    if (
      last
      && last.from === "bot"
      && last.streaming === false
      && !last.error
      && idx !== spokenIndexRef.current
    ) {
      spokenIndexRef.current = idx;
      speech.speak(last.text);
    }
  }, [messages, autoSpeak, speech]);

  // Switching modules starts a new conversation — stop any in-progress speech.
  useEffect(() => {
    speech.stopSpeaking();
  }, [moduleCode]); // eslint-disable-line react-hooks/exhaustive-deps

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

            <div className={styles.voiceControls}>
              <div className={styles.langToggleGroup}>
                <span className={styles.langToggleLabel}>Mic:</span>
                {STT_LANGUAGES.map((l) => (
                  <PMButton
                    key={l.code}
                    size="sm"
                    variant={sttLang === l.code ? "primary" : "outline"}
                    disabled={speech.isRecording}
                    onClick={() => setSttLang(l.code)}
                  >
                    {l.label}
                  </PMButton>
                ))}
              </div>

              <div className={styles.langToggleGroup}>
                <span className={styles.langToggleLabel}>Voice:</span>
                {TTS_MODES.map((m) => (
                  <PMButton
                    key={m.code}
                    size="sm"
                    variant={ttsLangMode === m.code ? "primary" : "outline"}
                    onClick={() => setTtsLangMode(m.code)}
                  >
                    {m.label}
                  </PMButton>
                ))}
              </div>

              <PMButton
                size="sm"
                variant={autoSpeak ? "primary" : "outline"}
                onClick={() => setAutoSpeak((v) => !v)}
                title="Automatically speak new AI replies"
              >
                🔊 Auto-speak: {autoSpeak ? "On" : "Off"}
              </PMButton>

              {speech.isSpeaking && (
                <span className={styles.speakingBadge}>
                  🔊 Speaking…
                  <PMButton size="sm" variant="ghost" onClick={speech.stopSpeaking}>⏸ Stop</PMButton>
                </span>
              )}
            </div>
          </div>

          <div ref={scrollRef} className={styles.chatMessages}>
            {messages.length === 0 && (
              <div className={styles.muted}>Ask a question to test this module's knowledge base.</div>
            )}
            {messages.map((m, i) => {
              const isLastBot = m.from === "bot" && i === messages.length - 1;
              return (
                <div key={i} className={m.from === "user" ? styles.userBubble : (m.error ? styles.errorBubble : styles.botBubble)}>
                  {m.error ? `⚠️ ${m.error}` : m.text}
                  {m.streaming && <span className={styles.cursor} />}
                  {isLastBot && !m.streaming && !m.error && speech.ttsSupported && (
                    <div className={styles.messageVoiceRow}>
                      {speech.isSpeaking ? (
                        <PMButton size="sm" variant="ghost" onClick={speech.stopSpeaking}>⏸ Stop</PMButton>
                      ) : (
                        <PMButton size="sm" variant="ghost" onClick={() => speech.speak(m.text)}>🔊 Speak</PMButton>
                      )}
                      <PMButton size="sm" variant="ghost" onClick={speech.replay}>🔁 Replay</PMButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.chatInputBar}>
            <PMButton
              size="md"
              variant={speech.isRecording ? "danger" : "outline"}
              disabled={loading || !moduleCode || !speech.sttSupported}
              onClick={speech.isRecording ? speech.stopRecording : () => speech.startRecording()}
              title={
                !speech.sttSupported
                  ? "Voice input not supported in this browser (try Chrome or Edge)"
                  : speech.isRecording ? "Stop recording" : "Start voice input"
              }
            >
              {speech.isRecording ? "⏹" : <img src={MicIcon} alt="Microphone" className={styles.micIcon} />}
            </PMButton>
            <input
              className={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={speech.isRecording ? (speech.interimText || "Listening…") : "Ask a question…"}
              disabled={loading || !moduleCode}
            />
            {speech.isRecording && <span className={styles.recordingDot} title="Recording" />}
            <PMButton onClick={handleSend} disabled={loading || !moduleCode}>
              {loading ? "Asking…" : "Send"}
            </PMButton>
          </div>
          {speech.sttError && <div className={styles.voiceHint}>{speech.sttError}</div>}
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
