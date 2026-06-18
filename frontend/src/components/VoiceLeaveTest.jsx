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

    <div style={{
      background: "white",
      border: "1px solid #fde68a",
      borderLeft: "4px solid #f59e0b",
      borderRadius: 14,
      padding: 22,
      marginBottom: 18,
      boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
    }}>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <span style={{
          fontSize: 9,
          fontWeight: 800,
          color: "#92400e",
          letterSpacing: 2,
          textTransform: "uppercase"
        }}>
          POC · Voice Test
        </span>
        <span style={{ fontSize: 11, color: "#92400e", opacity: 0.7 }}>
          (backend not wired yet — this is to validate transcription quality)
        </span>
      </div>

      <h3 style={{
        margin: "0 0 6px",
        fontSize: 18,
        fontWeight: 800,
        color: "#0f172a",
        letterSpacing: -0.2
      }}>
        Speak your leave request
      </h3>

      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
        Pick a language, tap the mic, say your request the way you'd say it to your manager.
        We'll show what the browser heard. If it's accurate enough, voice-based leave is viable.
      </p>

      {!supported && (
        <div style={{
          background: "#fee2e2",
          color: "#991b1b",
          padding: 12,
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12
        }}>
          ⚠ Your browser doesn't expose the Web Speech API.
          Open this page in Chrome, Edge, or Safari (desktop or mobile).
        </div>
      )}

      {/* Language picker */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: "#64748b",
          letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4
        }}>
          Language
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {LANGUAGES.map((l) => {

            const isOn = lang === l.code;

            return (
              <button
                key={l.code}
                type="button"
                disabled={listening}
                onClick={() => setLang(l.code)}
                style={{
                  flex: 1,
                  padding: "8px 6px",
                  borderRadius: 8,
                  border: `1px solid ${isOn ? "#8B0B1F" : "#cbd5e1"}`,
                  background: isOn ? "#fee2e2" : "white",
                  color: isOn ? "#8B0B1F" : "#475569",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: 0.4,
                  cursor: listening ? "default" : "pointer",
                  opacity: listening ? 0.6 : 1
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mic button */}
      <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={!supported}
          style={{
            width: 96, height: 96, borderRadius: "50%",
            border: "none",
            background: listening
              ? "linear-gradient(135deg, #ef4444, #b91c1c)"
              : (supported
                  ? "linear-gradient(135deg, #C8102E, #8B0B1F)"
                  : "#cbd5e1"),
            color: "white",
            cursor: supported ? "pointer" : "not-allowed",
            boxShadow: listening
              ? "0 0 0 8px rgba(239,68,68,0.15), 0 6px 24px rgba(185,28,28,0.4)"
              : "0 4px 14px rgba(139,11,31,0.30)",
            transition: "all 0.15s ease",
            animation: listening ? "voicePulse 1.4s ease-in-out infinite" : "none",
            display: "inline-flex", alignItems: "center", justifyContent: "center"
          }}
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

        <div style={{
          marginTop: 10,
          fontSize: 12,
          color: listening ? "#b91c1c" : "#64748b",
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase"
        }}>
          {listening ? "Listening… tap to stop" : "Tap to start"}
        </div>
      </div>

      {/* Live + final transcript */}
      <div style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: 14,
        minHeight: 90,
        fontSize: 14,
        lineHeight: 1.55,
        color: "#0f172a"
      }}>
        {finalText
          ? <span>{finalText}</span>
          : <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
              Transcript will appear here…
            </span>
        }

        {interim && (
          <span style={{ color: "#94a3b8" }}>
            {" "}{interim}
          </span>
        )}
      </div>

      {/* Confidence + diagnostic */}
      {(finalText || error) && (
        <div style={{
          marginTop: 10,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          fontSize: 11,
          color: "#64748b"
        }}>
          {confidence !== null && (
            <span style={{
              padding: "3px 9px",
              borderRadius: 999,
              background: confidence >= 0.8 ? "#dcfce7"
                        : confidence >= 0.6 ? "#fef3c7"
                        : "#fee2e2",
              color:      confidence >= 0.8 ? "#166534"
                        : confidence >= 0.6 ? "#92400e"
                        : "#991b1b",
              fontWeight: 700,
              letterSpacing: 0.3
            }}>
              Confidence: {Math.round(confidence * 100)}%
            </span>
          )}
          {finalText && (
            <button
              type="button"
              onClick={() => {
                setFinalText("");
                setInterim("");
                setConfidence(null);
                setError("");
              }}
              style={{
                background: "transparent",
                border: "1px solid #cbd5e1",
                color: "#475569",
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                cursor: "pointer"
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{
          marginTop: 12,
          padding: "10px 12px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 8,
          fontSize: 12
        }}>
          {error}
        </div>
      )}

      <style>{`
        @keyframes voicePulse {
          0%, 100% { box-shadow: 0 0 0 8px rgba(239,68,68,0.15), 0 6px 24px rgba(185,28,28,0.4); }
          50%      { box-shadow: 0 0 0 14px rgba(239,68,68,0.05), 0 6px 24px rgba(185,28,28,0.4); }
        }
      `}</style>
    </div>
  );
}


export default VoiceLeaveTest;
