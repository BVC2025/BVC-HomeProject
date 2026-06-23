// =====================================================================
// VoiceLeaveTest.jsx — POC validator for voice-driven leave requests.
//
// Goal of this card: prove that the browser's free Web Speech API can
// transcribe your employees' voices well enough to drive an
// AI-parsed leave request. Backend is NOT wired yet — once the
// transcript quality is good enough, we'll plumb it into the existing
// leave_chatbot_service.
//
// How to test:
//   1. Pick a language (English / Tamil / Hindi).
//   2. Tap the big mic button. Say something like:
//        EN:  "I need two days casual leave next Monday and Tuesday."
//        TA:  "Naalai sick leave venum, kaaichal."
//        HI:  "Mujhe kal aur parson casual leave chahiye."
//   3. Stop. Read the transcript.
//   4. If the transcript matches what you said, the POC is viable —
//      tell Claude and we'll wire the backend next.
//   5. If transcription is garbled, we pivot to self-hosted Whisper.
//
// Notes:
//   - Browser must be Chrome/Edge/Safari (Firefox WebKit STT is gated).
//   - Requires HTTPS — works through the Cloudflare tunnel and on
//     localhost, but NOT on a raw 192.168.x.x address from a phone.
//   - First use will prompt for Mic permission. Grant it.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import styles from "./VoiceLeaveTest.module.css";


const LANGUAGES = [
  { code: "en-IN", label: "English (India)" },
  { code: "ta-IN", label: "Tamil" },
  { code: "hi-IN", label: "Hindi" },
];


function VoiceLeaveTest() {

  // -- Browser support check ----------------------------------------
  const SR =
    (typeof window !== "undefined") &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const [supported] = useState(!!SR);

  // -- State --------------------------------------------------------
  const [lang, setLang]           = useState("en-IN");
  const [listening, setListening] = useState(false);
  const [interim, setInterim]     = useState("");
  const [finalText, setFinalText] = useState("");
  const [error, setError]         = useState("");
  const [confidence, setConfidence] = useState(null);

  const recogRef = useRef(null);

  // -- Recognition lifecycle ----------------------------------------
  const start = () => {

    if (!SR) {
      setError("Your browser doesn't support Web Speech API. Use Chrome, Edge, or Safari.");
      return;
    }

    if (listening) return;

    setError("");
    setInterim("");
    setFinalText("");
    setConfidence(null);

    const r = new SR();
    r.lang = lang;
    r.continuous = true;          // keep going until user stops
    r.interimResults = true;      // show live partial transcription
    r.maxAlternatives = 1;

    r.onresult = (e) => {

      let interimChunk = "";
      let finalChunk   = "";
      let bestConfidence = null;

      for (let i = e.resultIndex; i < e.results.length; i++) {

        const result = e.results[i];

        if (result.isFinal) {
          finalChunk += result[0].transcript;
          if (bestConfidence === null || result[0].confidence > bestConfidence) {
            bestConfidence = result[0].confidence;
          }
        } else {
          interimChunk += result[0].transcript;
        }
      }

      if (finalChunk) {
        setFinalText((prev) => (prev + " " + finalChunk).trim());
        if (bestConfidence !== null) setConfidence(bestConfidence);
      }

      setInterim(interimChunk);
    };

    r.onerror = (e) => {

      const map = {
        "no-speech":       "No speech detected. Move closer to the mic and try again.",
        "audio-capture":   "Microphone not found / not permitted.",
        "not-allowed":     "Microphone permission denied. Allow it in the browser address bar.",
        "network":         "Network error — Web Speech API needs internet to reach Google's STT.",
        "language-not-supported": `Browser doesn't support language ${lang} for speech.`,
      };

      setError(map[e.error] || `Recognition error: ${e.error}`);
      setListening(false);
    };

    r.onend = () => {

      setListening(false);
      setInterim("");
    };

    try {
      r.start();
      setListening(true);
      recogRef.current = r;
    } catch (err) {
      setError(`Could not start: ${err?.message || err}`);
      setListening(false);
    }
  };

  const stop = () => {

    if (recogRef.current) {
      try {
        recogRef.current.stop();
      } catch (e) { /* swallow */ }
    }

    setListening(false);
  };

  // Cleanup on unmount
  useEffect(() => {

    return () => {
      if (recogRef.current) {
        try { recogRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, []);

  // -- Render -------------------------------------------------------

  return (
    <div className={styles.card}>

      <div className={styles.badgeRow}>
        <span className={styles.pocBadge}>POC · Voice Test</span>
        <span className={styles.pocSub}>
          (backend not wired yet — this is to validate transcription quality)
        </span>
      </div>

      <h3 className={styles.title}>Speak your leave request</h3>

      <p className={styles.description}>
        Pick a language, tap the mic, say your request the way you'd say it to your manager.
        We'll show what the browser heard. If it's accurate enough, voice-based leave is viable.
      </p>

      {!supported && (
        <div className={styles.unsupported}>
          ⚠ Your browser doesn't expose the Web Speech API.
          Open this page in Chrome, Edge, or Safari (desktop or mobile).
        </div>
      )}

      {/* Language picker */}
      <div className={styles.langSection}>
        <div className={styles.langLabel}>Language</div>
        <div className={styles.langRow}>
          {LANGUAGES.map((l) => {
            const isOn = lang === l.code;
            return (
              <button
                key={l.code}
                type="button"
                disabled={listening}
                onClick={() => setLang(l.code)}
                className={`${styles.langBtn}${isOn ? ` ${styles.langBtnActive}` : ""}`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mic button */}
      <div className={styles.micArea}>
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={!supported}
          className={`${styles.micBtn} ${listening ? styles.micBtnListening : styles.micBtnIdle}`}
          title={listening ? "Stop" : "Tap to speak"}
        >
          {listening ? (
            <svg width="36" height="36" viewBox="0 0 24 24" fill="white">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
                 stroke="white" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
            </svg>
          )}
        </button>
        <div className={`${styles.micLabel} ${listening ? styles.micLabelListening : styles.micLabelIdle}`}>
          {listening ? "Listening… tap to stop" : "Tap to start"}
        </div>
      </div>

      {/* Transcript */}
      <div className={styles.transcriptBox}>
        {finalText
          ? <span>{finalText}</span>
          : <span className={styles.transcriptPlaceholder}>Transcript will appear here…</span>
        }
        {interim && <span className={styles.transcriptInterim}> {interim}</span>}
      </div>

      {/* Confidence + diagnostic */}
      {(finalText || error) && (
        <div className={styles.diagRow}>
          {confidence !== null && (
            <span className={
              confidence >= 0.8 ? styles.confHigh :
              confidence >= 0.6 ? styles.confMid :
                                   styles.confLow
            }>
              Confidence: {Math.round(confidence * 100)}%
            </span>
          )}
          {finalText && (
            <button
              type="button"
              onClick={() => { setFinalText(""); setInterim(""); setConfidence(null); setError(""); }}
              className={styles.clearBtn}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}
    </div>
  );
}


export default VoiceLeaveTest;

