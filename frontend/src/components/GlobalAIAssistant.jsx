import { useCallback, useEffect, useRef, useState } from "react";

import { useRagChat } from "../hooks/useRagChat";
import { useSpeech, detectSpokenLang } from "../hooks/useSpeech";
import MicIcon from "../assets/Icons/mike.webp";
import styles from "./GlobalAIAssistant.module.css";

const MODULE_CODE = "erp-assistant";

const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

function ChatIcon() {
  return (
    <svg {...ICON_PROPS} width="22" height="22">
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

function SpeakerOnIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M15 9l5 6M20 9l-5 6" />
    </svg>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function renderWithLinks(text) {
  return text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
      : part
  );
}

// ERP-wide voice/text assistant — a floating bubble available on every
// admin page (mounted once in Dashboard.jsx, outside <Routes>, so the
// conversation survives page navigation). Talks to the "erp-assistant"
// AI module (self-hosted Qwen3 via Ollama — see backend
// app/rag_modules/core/ollama_llm_client.py), reusing the same
// useRagChat/useSpeech hooks the AI Playground page already proved out.
export default function GlobalAIAssistant() {

  const [open, setOpen] = useState(false);

  const [input, setInput] = useState("");

  const [autoSpeak, setAutoSpeak] = useState(true);

  const [sttLang, setSttLang] = useState("en-IN");

  const scrollRef = useRef(null);

  const spokenIndexRef = useRef(-1);

  const { messages, send, loading } = useRagChat(MODULE_CODE);

  const handleFinalTranscript = useCallback((text) => {

    // Voice-first flow: a completed spoken utterance sends immediately,
    // rather than just filling the text box (unlike the AI Playground's
    // page, where the admin usually wants to review/edit first).
    setSttLang(detectSpokenLang(text).replace(/^([a-z]{2}).*/i, (_m, code) => `${code}-IN`));

    send(text);

  }, [send]);

  // engine="kokoro": better-quality voice for English (and Hindi) —
  // Tamil/Malayalam replies transparently fall back to the existing
  // Piper voices server-side (Kokoro has no voice for those languages).
  const speech = useSpeech({
    sttLang,
    ttsLangMode: "auto",
    ttsEngine: "kokoro",
    onFinalResult: handleFinalTranscript,
  });

  useEffect(() => {

    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;

  }, [messages, open]);

  // Speak each completed bot reply exactly once (index-guarded so this
  // doesn't refire on every streaming chunk) — same pattern as
  // AIPlaygroundPage.jsx.
  useEffect(() => {

    if (!autoSpeak || !open) return;

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

  }, [messages, autoSpeak, open, speech]);

  const submit = (e) => {

    e.preventDefault();

    const text = input.trim();

    if (!text || loading) return;

    setInput("");

    send(text);
  };

  const toggleOpen = () => {

    if (open) speech.stopSpeaking();

    setOpen((o) => !o);
  };

  return (
    <div className={styles.root}>

      {open && (
        <div className={styles.panel}>

          <div className={styles.header}>
            <span className={styles.headerTitle}>ERP Assistant</span>
            <button
              type="button"
              className={styles.headerBtn}
              onClick={() => setAutoSpeak((v) => !v)}
              title={autoSpeak ? "Auto-speak replies: on" : "Auto-speak replies: off"}
            >
              {autoSpeak ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
            </button>
            <button type="button" className={styles.headerBtn} onClick={toggleOpen} aria-label="Close">
              <CloseIcon />
            </button>
          </div>

          <div className={styles.messages} ref={scrollRef}>

            {messages.length === 0 && (
              <div className={styles.emptyState}>
                Ask me anything about the ERP — type or tap the mic to speak.
                I'll reply in whichever language you use.
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={m.from === "user" ? styles.bubbleUser : styles.bubbleBot}
              >
                {renderWithLinks(m.text || (m.streaming ? "…" : ""))}
                {m.error && <div className={styles.errorText}>{m.error}</div>}
                {m.from === "bot" && !m.streaming && m.text && (
                  <button
                    type="button"
                    className={styles.speakBtn}
                    onClick={() => speech.speak(m.text)}
                    aria-label="Play this reply aloud"
                  >
                    <SpeakerOnIcon />
                  </button>
                )}
              </div>
            ))}

          </div>

          {speech.sttError && <div className={styles.errorBanner}>{speech.sttError}</div>}
          {speech.ttsError && <div className={styles.errorBanner}>{speech.ttsError}</div>}

          <form className={styles.inputRow} onSubmit={submit}>

            {speech.sttSupported && (
              <button
                type="button"
                className={speech.isRecording ? styles.micBtnActive : styles.micBtn}
                onClick={() => (speech.isRecording ? speech.stopRecording() : speech.startRecording())}
                title={speech.isRecording ? "Stop listening" : "Speak your question"}
              >
                <img src={MicIcon} alt="Mic" />
              </button>
            )}

            <input
              type="text"
              className={styles.input}
              placeholder={speech.isRecording ? (speech.interimText || "Listening…") : "Ask a question…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={speech.isRecording}
            />

            <button type="submit" className={styles.sendBtn} disabled={loading || !input.trim()}>
              Send
            </button>

          </form>

        </div>
      )}

      <button
        type="button"
        className={styles.bubble}
        onClick={toggleOpen}
        aria-label={open ? "Close ERP Assistant" : "Open ERP Assistant"}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>

    </div>
  );
}
