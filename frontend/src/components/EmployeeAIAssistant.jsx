// =====================================================================
// EmployeeAIAssistant — voice + chat AI helper for the ESS portal.
// ---------------------------------------------------------------------
// A single floating icon at the bottom-right. Tapping it opens a
// panel that supports both channels simultaneously:
//
//   Chat   — type a question, get a text reply.
//   Voice  — tap the mic to speak; reply is both shown and read aloud.
//
// On first open, the assistant greets with:
//   "Hello! How can I help you today?"
// spoken via speechSynthesis AND written into the chat log. Voice is
// on by default; user can mute the speaker at any time.
//
// Backend
//   POST /hr-bot/message  { EMPLOYEE_ID, message, history }
//   → { reply: string, citations?: [], actions?: [] }
//
// The backend chatbot answers policy / HR / leave / attendance /
// payroll / benefits / IT-support questions (rule-based today; the
// Phase-1 RAG upgrade will slot in without touching this UI).
//
// Browser APIs used
//   window.speechSynthesis + SpeechSynthesisUtterance     (TTS)
//   window.SpeechRecognition / webkitSpeechRecognition   (STT)
//
// Both APIs degrade gracefully — if the browser doesn't support them,
// the corresponding button is hidden and the other channel still works.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import API from "../services/api";
import {
  isVoiceSupported as isTtsSupported,
  speak,
  stopSpeaking,
} from "../services/voiceAlerts";

import styles from "./EmployeeAIAssistant.module.css";


// ------------------------------------------------------------------
// Icons — small stroke SVGs, currentColor
// ------------------------------------------------------------------
const icon = (children, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  bot:    icon(<>
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
    <path d="M12 3v4" />
    <circle cx="12" cy="3" r="0.9" fill="currentColor" />
    <path d="M9 13h.01M15 13h.01" strokeWidth="2.4" />
    <path d="M2 12h2M20 12h2" />
    <path d="M9 17h6" />
  </>, 22),
  send:   icon(<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />),
  mic:    icon(<>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3M8 21h8" />
  </>),
  micOff: icon(<>
    <path d="M3 3l18 18" />
    <path d="M9 9v3a3 3 0 0 0 5.1 2.1" />
    <path d="M15 12V6a3 3 0 0 0-6-0.5" />
    <path d="M5 11a7 7 0 0 0 11.4 5.4" />
    <path d="M19 11a7 7 0 0 1-0.3 2" />
    <path d="M12 18v3M8 21h8" />
  </>),
  speaker: icon(<>
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18 6a9 9 0 0 1 0 12" />
  </>),
  speakerOff: icon(<>
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M22 9l-6 6M16 9l6 6" />
  </>),
  close:  icon(<path d="M18 6L6 18M6 6l12 12" />),
  spark:  icon(<path d="M12 2l2.4 6.9L22 10l-6 4.7L18 22l-6-4-6 4 2-7.3L2 10l7.6-1.1z" />, 14),
};


// ------------------------------------------------------------------
// Web Speech Recognition support probe
// ------------------------------------------------------------------
function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}


const GREETING = "Hello! How can I help you today?";


// ==================================================================
// Component
// ==================================================================
export default function EmployeeAIAssistant() {

  const employeeCode =
       localStorage.getItem("employee_code")
    || localStorage.getItem("employee_id")
    || "";
  const employeeName =
    (localStorage.getItem("employee_name") || "").trim();

  const [open, setOpen] = useState(false);

  // Voice output — on by default so the greeting is spoken
  const [voiceOn, setVoiceOn] = useState(true);

  // Live voice input state
  const [listening, setListening] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  // Conversation
  //   { role: "assistant" | "user", content: string, ts: number }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft]       = useState("");
  const [pending, setPending]   = useState(false);

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  // Slot-state for the multi-turn HR bot conversation. Sent with
  // every /hr-bot/message request; updated from each response.
  const contextRef = useRef({ state: "idle" });

  const ttsSupported = isTtsSupported();
  const sttSupported = !!getSpeechRecognition();


  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------

  const addMessage = useCallback((role, content) => {
    setMessages((prev) => [...prev, { role, content, ts: Date.now() }]);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  useEffect(scrollToBottom, [messages, pending, scrollToBottom]);


  // -------------------------------------------------------------
  // Greeting — fired the first time the panel opens per session
  // -------------------------------------------------------------
  const greetedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (greetedRef.current) return;
    greetedRef.current = true;

    // Personalise if we know the name — still speak the same phrase
    // so the user hears exactly the greeting they were promised.
    const displayed = employeeName
      ? `Hello ${employeeName.split(/\s+/)[0]}! How can I help you today?`
      : GREETING;

    addMessage("assistant", displayed);

    if (voiceOn && ttsSupported) {
      // Small delay so speech unblocks after the click event completes
      // — Chrome throttles TTS started synchronously inside onClick.
      window.setTimeout(() => speak(GREETING), 120);
    }
  }, [open, voiceOn, ttsSupported, employeeName, addMessage]);


  // -------------------------------------------------------------
  // Send to backend
  // -------------------------------------------------------------
  const sendToBot = useCallback(async (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed || pending) return;

    addMessage("user", trimmed);
    setDraft("");
    setPending(true);

    // Slot-based context state the /hr-bot/message endpoint keeps
     // between turns (idle → collecting leave dates → confirm → …).
     // We ask the server to keep it stateless — send back whatever
     // it gave us last time, or `idle` on the first turn.
    try {
      const res = await API.post("/hr-bot/message", {
        employee_id: employeeCode,
        message: trimmed,
        context: contextRef.current || { state: "idle" },
      });

      const data = res.data || {};

      // The endpoint returns { reply | message, context, ... } —
      // accept whichever key it settled on and stash the new context
      // for the next turn.
      const reply =
           (typeof data.reply   === "string" && data.reply)
        || (typeof data.answer  === "string" && data.answer)
        || (typeof data.message === "string" && data.message)
        || "Sorry, I couldn't come up with an answer for that.";

      if (data.context && typeof data.context === "object") {
        contextRef.current = data.context;
      }

      addMessage("assistant", reply);

      if (voiceOn && ttsSupported) {
        speak(reply);
      }

    } catch (err) {
      // FastAPI 422 returns `detail` as an ARRAY of validation
      // errors, not a string — passing that to React kills the
      // tree. Normalise every shape to a plain string here.
      const raw = err?.response?.data?.detail;
      let detail;
      if (typeof raw === "string" && raw.trim()) {
        detail = raw;
      } else if (Array.isArray(raw) && raw.length) {
        detail = raw
          .map((e) => e?.msg || e?.message || "")
          .filter(Boolean)
          .join(" · ") || "The request was rejected by the server.";
      } else if (err?.response?.status === 404) {
        detail = "The assistant service isn't reachable right now.";
      } else if (!err?.response) {
        detail = "I can't reach the server — check your connection and try again.";
      } else {
        detail = "I'm having trouble responding right now — try again in a moment.";
      }
      addMessage("assistant", detail);
    } finally {
      setPending(false);
    }
  }, [
    pending, addMessage, employeeCode,
    voiceOn, ttsSupported,
  ]);


  // -------------------------------------------------------------
  // Voice INPUT (Web Speech Recognition)
  // -------------------------------------------------------------
  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    // Cancel any in-flight speech before recording so the user
    // doesn't overhear the assistant while dictating.
    stopSpeaking();

    const recognition = new SR();
    recognition.continuous     = false;
    recognition.interimResults = false;
    recognition.lang           = "en-IN";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      if (transcript.trim()) {
        sendToBot(transcript);
      }
    };

    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMicDenied(true);
      }
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch { /* rapid re-taps can throw; harmless */ }
  }, [sendToBot]);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  }, []);


  // -------------------------------------------------------------
  // Voice OUTPUT — toggle
  // -------------------------------------------------------------
  const toggleVoice = useCallback(() => {
    setVoiceOn((prev) => {
      const next = !prev;
      if (!next) stopSpeaking();
      return next;
    });
  }, []);


  // -------------------------------------------------------------
  // Suggested prompts — shown until the user has typed something
  // -------------------------------------------------------------
  const suggestions = useMemo(() => ([
    "How much leave do I have left?",
    "How do I apply for permission?",
    "When will my salary be credited?",
    "What's the office holiday list?",
  ]), []);

  const showSuggestions = messages.length <= 1 && !pending;


  // -------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------
  useEffect(() => {
    return () => {
      stopSpeaking();
      try { recognitionRef.current?.abort?.(); } catch { /* ignore */ }
    };
  }, []);


  // -------------------------------------------------------------
  // Render
  // -------------------------------------------------------------

  if (!open) {
    return (
      <button
        type="button"
        className={styles.launcher}
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
      >
        <span className={styles.launcherIcon}>{I.bot}</span>
        <span className={styles.launcherPulse} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={styles.panel} role="dialog" aria-label="Employee AI Assistant">

      {/* ---------- Header ---------- */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerAvatar}>{I.bot}</div>
          <div className={styles.headerText}>
            <div className={styles.headerTitle}>
              Employee AI Assistant
              <span className={styles.headerBadge}>
                {I.spark} AI
              </span>
            </div>
            <div className={styles.headerSub}>
              <span className={styles.dot} />
              {listening
                ? "Listening…"
                : pending
                  ? "Thinking…"
                  : "Ready to help — ask anything"}
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          {ttsSupported && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={toggleVoice}
              aria-label={voiceOn ? "Mute assistant voice" : "Unmute assistant voice"}
              title={voiceOn ? "Mute voice replies" : "Speak replies aloud"}
            >
              {voiceOn ? I.speaker : I.speakerOff}
            </button>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
          >
            {I.close}
          </button>
        </div>
      </div>


      {/* ---------- Messages ---------- */}
      <div className={styles.messages} ref={scrollRef}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`${styles.msg} ${m.role === "user" ? styles.msg_user : styles.msg_bot}`}
          >
            {m.role === "assistant" && (
              <span className={styles.msgAvatar}>{I.bot}</span>
            )}
            <div className={styles.msgBubble}>
              {typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content)}
            </div>
          </div>
        ))}

        {pending && (
          <div className={`${styles.msg} ${styles.msg_bot}`}>
            <span className={styles.msgAvatar}>{I.bot}</span>
            <div className={`${styles.msgBubble} ${styles.msgTyping}`}>
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>


      {/* ---------- Suggested prompts ---------- */}
      {showSuggestions && (
        <div className={styles.suggestions}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.suggestionChip}
              onClick={() => sendToBot(s)}
              disabled={pending}
            >
              {s}
            </button>
          ))}
        </div>
      )}


      {/* ---------- Input row ---------- */}
      <form
        className={styles.inputRow}
        onSubmit={(e) => {
          e.preventDefault();
          sendToBot(draft);
        }}
      >
        {sttSupported && (
          <button
            type="button"
            className={`${styles.micBtn} ${listening ? styles.micBtn_active : ""}`}
            onClick={listening ? stopListening : startListening}
            aria-label={listening ? "Stop recording" : "Speak"}
            title={
              micDenied
                ? "Microphone permission denied — enable it in browser settings"
                : listening ? "Stop recording" : "Tap to speak"
            }
          >
            {listening ? I.micOff : I.mic}
          </button>
        )}

        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? "Listening…" : "Type your question…"}
          className={styles.input}
          disabled={pending || listening}
          autoFocus
        />

        <button
          type="submit"
          className={styles.sendBtn}
          disabled={!draft.trim() || pending}
          aria-label="Send"
        >
          {I.send}
        </button>
      </form>

      {micDenied && (
        <div className={styles.notice}>
          Microphone access is blocked. You can still chat by typing.
        </div>
      )}
    </div>
  );
}
