// =====================================================================
// VoiceAssistant — Siri / Google-Assistant style widget.
// ---------------------------------------------------------------------
// UI states, top → bottom:
//   idle       — mic button pulses slowly, tap to start
//   listening  — mic waves animation, transcript being captured
//   thinking   — "Thinking…" while /voice/query is in flight
//   speaking   — TTS is voicing the reply; mic stays disabled
//
// The loop:
//   idle → tap → listening → user stops speaking (silence timer)
//        → thinking → reply arrives → speaking → back to listening
//        until conversation_complete === true, or the user says a
//        cancel word, or clicks the mic to force-stop.
//
// Backend:  POST /voice/query
// Browser:  window.SpeechRecognition | webkitSpeechRecognition,
//           window.speechSynthesis
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";

import API from "../services/api";
import styles from "./VoiceAssistant.module.css";


const CANCEL_KEYWORDS = ["cancel", "stop", "thank you", "never mind"];


// ---------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------
function newSessionId() {
  // Not cryptographically-secure — just unique enough per conversation.
  return `vs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}


// ---------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------
function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}


// ---------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------
export default function VoiceAssistant({ employeeId }) {

  // idle | listening | thinking | speaking
  const [state,    setState]    = useState("idle");
  const [open,     setOpen]     = useState(false);
  const [heard,    setHeard]    = useState("");
  const [assistantSaid, setAssistantSaid] = useState("");
  const [error,    setError]    = useState("");
  const [supported, setSupported] = useState(true);

  const sessionIdRef  = useRef(newSessionId());
  const recognitionRef = useRef(null);
  const activeRef      = useRef(false);
  // "activeRef" = true while the user has the assistant OPEN. If they
  // close it (X button), we tear down the loop cleanly.

  // ---------------- Feature detect on mount ----------------
  useEffect(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setSupported(false);
      return;
    }
  }, []);


  // ---------------- Speech synthesis ----------------
  const speak = useCallback((text) => new Promise((resolve) => {
    if (!text) { resolve(); return; }
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve(); return;
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 1.0;
      u.lang = "en-IN";
      // Prefer an Indian English voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) => /en[-_]IN/i.test(v.lang))
        || voices.find((v) => /en/i.test(v.lang));
      if (preferred) u.voice = preferred;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { resolve(); }
  }), []);


  // ---------------- Recognizer factory ----------------
  const buildRecognizer = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return null;
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    return r;
  }, []);


  // ---------------- Send transcript to backend ----------------
  const sendToBackend = useCallback(async (message) => {
    setState("thinking");
    setError("");
    try {
      const res = await API.post("/voice/query", {
        session_id:  sessionIdRef.current,
        employee_id: String(employeeId || ""),
        message,
      });
      const data = res.data || {};
      setAssistantSaid(data.reply || "");
      setState("speaking");
      await speak(data.reply || "");

      if (data.conversation_complete) {
        // Rotate session for the next task
        sessionIdRef.current = newSessionId();
        setState("idle");
        return;
      }

      // Loop: listen again automatically
      if (activeRef.current) startListening();
      else setState("idle");
    } catch (err) {
      const detail = err?.response?.data?.detail || "Voice service unavailable.";
      setError(detail);
      setState("idle");
    }
  }, [employeeId, speak]); // eslint-disable-line react-hooks/exhaustive-deps


  // ---------------- Start listening ----------------
  const startListening = useCallback(() => {
    if (!activeRef.current) return;
    const r = buildRecognizer();
    if (!r) { setSupported(false); return; }

    setHeard("");
    setError("");
    setState("listening");

    r.onresult = (event) => {
      try {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
        if (!transcript) return;
        setHeard(transcript);

        // Instant local cancel
        const lc = transcript.toLowerCase();
        if (CANCEL_KEYWORDS.some((k) => lc.includes(k))) {
          setAssistantSaid("Okay, cancelled.");
          setState("speaking");
          speak("Okay, cancelled.").then(() => {
            sessionIdRef.current = newSessionId();
            setState("idle");
          });
          return;
        }

        sendToBackend(transcript);
      } catch (e) {
        setError("Couldn't read your voice. Try again.");
        setState("idle");
      }
    };

    r.onerror = (e) => {
      // "no-speech" is common — just fall back to idle without an error banner
      if (e?.error !== "no-speech") {
        setError("Mic error: " + (e?.error || "unknown"));
      }
      setState("idle");
    };

    r.onend = () => {
      // Nothing — result / error handlers already transitioned state
    };

    recognitionRef.current = r;
    try {
      r.start();
    } catch {
      // Some browsers throw if start() is called before onend of prev instance.
      setTimeout(() => { try { r.start(); } catch { /* ignore */ } }, 150);
    }
  }, [buildRecognizer, sendToBackend, speak]);


  // ---------------- Public controls ----------------
  const openAssistant = useCallback(() => {
    setOpen(true);
    activeRef.current = true;
    setError("");
    setHeard("");
    setAssistantSaid("");
    sessionIdRef.current = newSessionId();
    // Slight delay so the modal is mounted before the mic prompt
    setTimeout(() => startListening(), 200);
  }, [startListening]);

  const closeAssistant = useCallback(() => {
    activeRef.current = false;
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setOpen(false);
    setState("idle");
  }, []);

  const toggleMic = useCallback(() => {
    if (state === "listening") {
      // Manual stop mid-listen
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setState("idle");
    } else if (state === "idle") {
      activeRef.current = true;
      startListening();
    }
  }, [state, startListening]);


  // ---------------- Cleanup on unmount ----------------
  useEffect(() => {
    return () => {
      activeRef.current = false;
      try { recognitionRef.current?.abort(); } catch { /* ignore */ }
      try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    };
  }, []);


  // ---------------- Render ----------------
  return (
    <>
      {/* Floating trigger — always visible bottom-right */}
      <button
        type="button"
        className={styles.fab}
        onClick={openAssistant}
        aria-label="Open voice assistant"
      >
        <MicIcon size={22} />
      </button>

      {open && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>

            <header className={styles.header}>
              <div className={styles.eyebrow}>Voice assistant</div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={closeAssistant}
                aria-label="Close"
              >×</button>
            </header>

            {/* Mic core */}
            <div className={styles.orbWrap}>
              <button
                type="button"
                className={`${styles.orb} ${styles[`orb_${state}`]}`}
                onClick={toggleMic}
                disabled={state === "thinking" || state === "speaking"}
                aria-label={state === "listening" ? "Stop listening" : "Start listening"}
              >
                <span className={styles.orbRing} />
                <span className={styles.orbRing} />
                <span className={styles.orbRing} />
                <MicIcon size={34} />
              </button>
            </div>

            {/* Status line */}
            <div className={styles.status}>
              {state === "listening" && <span>Listening…</span>}
              {state === "thinking"  && <span>Thinking…</span>}
              {state === "speaking"  && <span>Speaking…</span>}
              {state === "idle"      && <span>Tap the mic to speak.</span>}
            </div>

            {/* Transcript block */}
            {(heard || assistantSaid) && (
              <div className={styles.transcript}>
                {heard && (
                  <div className={styles.turn}>
                    <span className={styles.turnRole}>You</span>
                    <span className={styles.turnText}>{heard}</span>
                  </div>
                )}
                {assistantSaid && (
                  <div className={styles.turn}>
                    <span className={styles.turnRole}>Assistant</span>
                    <span className={styles.turnText}>{assistantSaid}</span>
                  </div>
                )}
              </div>
            )}

            {!supported && (
              <div className={styles.errorNote}>
                Your browser doesn&apos;t support speech recognition.
                Try Chrome or Edge on desktop.
              </div>
            )}
            {error && <div className={styles.errorNote}>{error}</div>}

            <footer className={styles.footer}>
              Try: &ldquo;Apply leave tomorrow&rdquo; · &ldquo;Leave balance&rdquo; ·
              &ldquo;My payslip for July&rdquo;
            </footer>
          </div>
        </div>
      )}
    </>
  );
}


function MicIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}
