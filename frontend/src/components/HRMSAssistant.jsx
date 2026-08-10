// =====================================================================
// HRMSAssistant — Gemini-powered chat assistant grounded on the
// company's HRMS documentation. Read-only. Multi-language.
//
// UX:
//   • Text input + Enter to send.
//   • Mic button toggles voice input (Web Speech API). Recognised
//     transcript populates the input, then user can Enter to send —
//     or long-press mic to send-on-release.
//   • Speaker toggle enables voice output on assistant replies.
//   • Language selector controls both the speech-recognition locale
//     AND is passed as a hint to the backend so the assistant replies
//     in the same language.
//   • Session id persisted in localStorage; "New chat" clears it.
//   • Source pills under each assistant message credit the module /
//     section that grounded the answer.
//
// Zero coupling to any other HRMS feature. Talks to /hrms-ai/* only.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import API from "../services/api";
import styles from "./HRMSAssistant.module.css";
import DocumentLibrary from "./DocumentLibrary";


// ---------------------------------------------------------------------
// Supported languages — extend freely. `code` is the BCP-47 tag we
// send to SpeechRecognition and speechSynthesis; `hint` is the short
// code we pass to the backend.
// ---------------------------------------------------------------------
const LANGUAGES = [
  { code: "en-IN", hint: "en", label: "English" },
  { code: "ta-IN", hint: "ta", label: "தமிழ்" },
  { code: "hi-IN", hint: "hi", label: "हिन्दी" },
  { code: "te-IN", hint: "te", label: "తెలుగు" },
  { code: "ml-IN", hint: "ml", label: "മലയാളം" },
  { code: "kn-IN", hint: "kn", label: "ಕನ್ನಡ" },
  { code: "mr-IN", hint: "mr", label: "मराठी" },
  { code: "bn-IN", hint: "bn", label: "বাংলা" },
  { code: "gu-IN", hint: "gu", label: "ગુજરાતી" },
  { code: "pa-IN", hint: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "ar",    hint: "ar", label: "العربية" },
  { code: "fr-FR", hint: "fr", label: "Français" },
  { code: "es-ES", hint: "es", label: "Español" },
  { code: "de-DE", hint: "de", label: "Deutsch" },
];


// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

const SESSION_KEY = "hrms_ai_session_id";
const LANG_KEY    = "hrms_ai_language";
const VOICE_KEY   = "hrms_ai_speak_out";

function newSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getStoredSessionId() {
  const v = localStorage.getItem(SESSION_KEY);
  if (v) return v;
  const fresh = newSessionId();
  localStorage.setItem(SESSION_KEY, fresh);
  return fresh;
}


// ---------------------------------------------------------------------
// SVG icons — inline stroke SVGs to match the rest of the app.
// ---------------------------------------------------------------------
const Icon = ({ children, size = 18 }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"
  >{children}</svg>
);
const IcSend    = () => <Icon><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></Icon>;
const IcMic     = () => <Icon><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 19v3" /></Icon>;
const IcMicOff  = () => <Icon><path d="M1 1l22 22" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /><path d="M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2" /><path d="M12 19v3" /></Icon>;
const IcVolume  = () => <Icon><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></Icon>;
const IcVolMute = () => <Icon><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></Icon>;
const IcPlus    = () => <Icon><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const IcSpark   = () => <Icon><path d="M12 2l1.9 5.3L19 9l-5.1 1.7L12 16l-1.9-5.3L5 9l5.1-1.7L12 2z" /></Icon>;


// =====================================================================
// Component
// =====================================================================

export default function HRMSAssistant() {

  const [sessionId, setSessionId] = useState(() => getStoredSessionId());
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState("");
  const [sending, setSending]     = useState(false);
  const [status, setStatus]       = useState(null);   // /status response
  const [error, setError]         = useState("");

  // Phase A — mount the DocumentLibrary section above the chat so
  // admins can upload / manage the knowledge corpus. Employees also
  // see the list (read-only). The chat / doc-selector integration
  // lands in Phase B once we index each uploaded document.
  const [showLibrary, setShowLibrary] = useState(false);

  const [langCode, setLangCode] = useState(
    () => localStorage.getItem(LANG_KEY) || "en-IN"
  );
  const [speakOut, setSpeakOut] = useState(
    () => (localStorage.getItem(VOICE_KEY) ?? "true") === "true"
  );
  const [listening, setListening] = useState(false);

  const listRef        = useRef(null);
  const recognitionRef = useRef(null);
  const inputRef       = useRef(null);

  const lang = useMemo(
    () => LANGUAGES.find((l) => l.code === langCode) || LANGUAGES[0],
    [langCode],
  );

  // -------------------------------------------------------------------
  // Bootstrap: read /status + load history
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statusRes, historyRes] = await Promise.all([
          API.get("/hrms-ai/status").catch(() => ({ data: null })),
          API.get(`/hrms-ai/history/${encodeURIComponent(sessionId)}`).catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        setStatus(statusRes.data || { enabled: false });
        const items = historyRes.data?.messages || [];
        setMessages(items.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.created_at,
          sources: [],
        })));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // -------------------------------------------------------------------
  // Auto-scroll to bottom on new message
  // -------------------------------------------------------------------
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // -------------------------------------------------------------------
  // Persist language + voice preferences
  // -------------------------------------------------------------------
  useEffect(() => { localStorage.setItem(LANG_KEY, langCode); }, [langCode]);
  useEffect(() => { localStorage.setItem(VOICE_KEY, String(speakOut)); }, [speakOut]);

  // -------------------------------------------------------------------
  // Voice input — Web Speech API
  // -------------------------------------------------------------------
  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("Voice input isn't supported by this browser. Try Chrome or Edge.");
      return;
    }
    const rec = new SR();
    rec.lang = langCode;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const t = ev.results[i][0]?.transcript || "";
        if (ev.results[i].isFinal) finalText += t;
        else interim += t;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      setListening(false);
      setError(`Voice input error: ${e?.error || "unknown"}`);
    };
    rec.onend = () => {
      setListening(false);
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
      setError("");
    } catch (e) {
      setError("Couldn't start voice input. Grant microphone permission and try again.");
    }
  }, [langCode]);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  }, []);

  // -------------------------------------------------------------------
  // Voice output — speechSynthesis
  // -------------------------------------------------------------------
  const speakText = useCallback((text) => {
    if (!speakOut) return;
    if (typeof window === "undefined") return;
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = langCode;
      u.rate = 1;
      u.pitch = 1;
      u.volume = 1;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) => v.lang === langCode)
                     || voices.find((v) => v.lang?.startsWith(langCode.slice(0, 2)));
      if (preferred) u.voice = preferred;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }, [speakOut, langCode]);

  // Stop TTS + STT when the component unmounts.
  useEffect(() => () => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  // -------------------------------------------------------------------
  // Ask
  // -------------------------------------------------------------------
  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;
    if (!status?.enabled) {
      setError("The HRMS AI assistant is currently disabled.");
      return;
    }
    if (!status?.gemini_configured) {
      setError("The assistant is not configured yet. Ask your admin to set GEMINI_API_KEY.");
      return;
    }

    setError("");
    setInput("");
    setSending(true);

    // Optimistic user turn
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question, sources: [] },
      { role: "assistant", content: "", sources: [], pending: true },
    ]);

    try {
      const res = await API.post("/hrms-ai/ask", {
        message: question,
        session_id: sessionId,
        language: lang.hint,
      });
      const { answer, sources } = res.data || {};

      setMessages((prev) => {
        const next = [...prev];
        // Replace the last pending assistant slot
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].role === "assistant" && next[i].pending) {
            next[i] = { role: "assistant", content: answer || "", sources: sources || [] };
            break;
          }
        }
        return next;
      });

      if (answer) speakText(answer);
    } catch (e) {
      const detail = e?.response?.data?.detail || "The assistant didn't respond. Try again.";
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].role === "assistant" && next[i].pending) {
            next[i] = { role: "assistant", content: `⚠ ${detail}`, sources: [] };
            break;
          }
        }
        return next;
      });
      setError(detail);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, status, sessionId, lang, speakText]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // -------------------------------------------------------------------
  // New chat — new session id, empty history
  // -------------------------------------------------------------------
  const newChat = useCallback(() => {
    if (sending) return;
    stopListening();
    const fresh = newSessionId();
    localStorage.setItem(SESSION_KEY, fresh);
    setSessionId(fresh);
    setMessages([]);
    setError("");
  }, [sending, stopListening]);


  // ===================================================================
  // Render
  // ===================================================================

  const disabled = !status?.enabled || !status?.gemini_configured;

  return (
    <div className={styles.wrap}>

      {/* Header */}
      <div className={styles.head}>
        <div>
          <div className={styles.eyebrow}>Employee Self-Service</div>
          <h1 className={styles.title}>
            <span className={styles.titleIcon}><IcSpark /></span>
            HRMS Assistant
          </h1>
          <p className={styles.sub}>
            Ask anything about attendance, leave, payroll, memos, announcements —
            in any language you speak. I answer only from the company's HRMS
            documentation.
          </p>
        </div>

        <div className={styles.headActions}>
          <select
            value={langCode}
            onChange={(e) => setLangCode(e.target.value)}
            className={styles.langSelect}
            aria-label="Language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setSpeakOut((v) => !v)}
            className={`${styles.iconBtn} ${speakOut ? styles.iconBtnActive : ""}`}
            title={speakOut ? "Voice replies on" : "Voice replies off"}
            aria-label="Toggle voice output"
          >
            {speakOut ? <IcVolume /> : <IcVolMute />}
          </button>

          <button
            type="button"
            onClick={() => setShowLibrary((v) => !v)}
            className={`${styles.iconBtn} ${showLibrary ? styles.iconBtnActive : ""}`}
            title={showLibrary ? "Hide library" : "Show document library"}
            aria-label="Toggle document library"
          >
            {/* Simple stacked-books glyph */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={newChat}
            className={styles.newBtn}
            title="Start a new conversation"
          >
            <IcPlus /> New chat
          </button>
        </div>
      </div>

      {/* Phase A — document library above the chat when toggled on.
          Chat integration (pick which doc to talk to) lands in Phase B. */}
      {showLibrary && (
        <div className={styles.libraryWrap}>
          <DocumentLibrary />
        </div>
      )}

      {/* Status banner (only when things are wrong) */}
      {status && !status.enabled && (
        <div className={styles.warnBanner}>
          The HRMS AI assistant is currently disabled by the administrator.
        </div>
      )}
      {status && status.enabled && !status.gemini_configured && (
        <div className={styles.warnBanner}>
          The assistant is not configured yet. GEMINI_API_KEY missing on the server.
        </div>
      )}
      {status && status.enabled && status.gemini_configured && status.index_chunks === 0 && (
        <div className={styles.warnBanner}>
          The knowledge base is empty. Ask an admin to run "Rebuild index" in the AI settings.
        </div>
      )}

      {/* Message list */}
      <div ref={listRef} className={styles.list}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><IcSpark /></div>
            <div className={styles.emptyTitle}>Ask me about the HRMS</div>
            <div className={styles.emptyBody}>
              Try: <em>"How much casual leave do I have per year?"</em> or
              &nbsp;<em>"What triggers a warning memo?"</em>
            </div>
            <div className={styles.emptyStarters}>
              {[
                "How is my absent-day deduction calculated?",
                "How many late arrivals before I get a memo?",
                "What are the leave types?",
                "How does the biometric device work?",
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  className={styles.starter}
                  onClick={() => setInput(q)}
                  disabled={disabled}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`${styles.msg} ${m.role === "user" ? styles.msgUser : styles.msgBot}`}
          >
            {m.role === "assistant" && (
              <div className={styles.avatar}><IcSpark /></div>
            )}
            <div className={styles.bubble}>
              {m.pending ? (
                <div className={styles.typing}>
                  <span /><span /><span />
                </div>
              ) : (
                <>
                  <div className={styles.bubbleText}>{m.content}</div>
                  {m.sources && m.sources.length > 0 && (
                    <div className={styles.sources}>
                      {m.sources.slice(0, 4).map((s, idx) => (
                        <span key={idx} className={styles.sourcePill}>
                          {s.module} · {s.section}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className={styles.composer}>
        {error && <div className={styles.err}>{error}</div>}

        <div className={styles.inputRow}>
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            className={`${styles.micBtn} ${listening ? styles.micBtnActive : ""}`}
            title={listening ? "Stop listening" : "Speak your question"}
            aria-label="Toggle voice input"
            disabled={disabled || sending}
          >
            {listening ? <IcMicOff /> : <IcMic />}
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              disabled
                ? "Assistant unavailable"
                : listening
                ? "Listening…"
                : "Ask a question in any language"
            }
            className={styles.input}
            rows={1}
            disabled={disabled || sending}
          />

          <button
            type="button"
            onClick={send}
            disabled={disabled || sending || !input.trim()}
            className={styles.sendBtn}
            title="Send"
            aria-label="Send message"
          >
            <IcSend />
          </button>
        </div>

        <div className={styles.footHint}>
          Answers come strictly from the HRMS documentation. When something isn't documented, I'll say so — I won't guess.
        </div>
      </div>

    </div>
  );
}
