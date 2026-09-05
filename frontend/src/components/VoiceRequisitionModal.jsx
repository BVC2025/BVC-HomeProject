// =====================================================================
// VoiceRequisitionModal — voice-first Recruitment Requisition creation.
//
// HR clicks the mic, speaks freely in Tamil / English / Thanglish
// ("Production department la Assembly ku rendu candidate venum,
//  Diploma-oda welding theriyanum"), the browser transcribes via
// SpeechRecognition (webkit / native) and streams every phrase to
// /recruitment/voice-agent/interpret. The backend (Qwen 2.5 72B via
// OpenRouter) returns either a follow-up question — spoken back
// aloud via Sarvam AI's female voice — or a full requisition draft.
//
// Once the draft is complete, HR sees the extracted fields laid out
// in a preview panel, and can either say "confirm" / "yes" (or
// click the button) to commit the requisition — same server-side
// path the manual + New Requisition form uses.
//
// Phase 1 (this file): browser Web Speech API for STT + TTS.
// Phase 2 (roadmap):    swap in Whisper + XTTS custom voice — the
//                       server contract stays identical.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import API from "../services/api";

const BVC_RED = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";

// Fields that MUST be present before we let HR commit.
const CRITICAL_FIELDS = ["POSITION_TITLE", "DEPARTMENT"];

// Words that mean "yes, create it" — matched case-insensitive against
// the LATEST transcript when a draft is on screen.
const CONFIRM_TRIGGERS = [
  "confirm", "yes create", "yes, create", "yes create it",
  "create it", "go ahead", "please create", "submit", "raise it",
  // Tamil / Thanglish
  "sari", "seri", "aama", "aamam", "aan", "aanaa", "seri create",
  "seri panunga", "post pannunga", "post panu", "create panu",
  "create panunga",
];

const CANCEL_TRIGGERS = [
  "cancel", "no cancel", "no not", "stop",
  "veenam", "vendaam", "vendam", "illa",
];


// ---------------------------------------------------------------------
// Browser Web Speech API — reasonably supported on Chrome / Edge.
// Firefox has no native recognition; the modal falls back to a
// simple text input so the flow still works.
// ---------------------------------------------------------------------

function getRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}


// Very simple language guess — used to hint the server-side TTS.
function detectLang(text) {
  if (!text) return "en-IN";
  if (/[஀-௿]/.test(text)) return "ta-IN";
  if (/[ऀ-ॿ]/.test(text)) return "hi-IN";
  return "en-IN";
}


// =====================================================================
// Component
// =====================================================================

export default function VoiceRequisitionModal({ onClose, onCommitted }) {

  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [history, setHistory] = useState([]);   // [{role, content}]
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState(null);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [manualInput, setManualInput] = useState("");
  // Recognition language — user-selectable so Tamil speakers don't
  // fight Chrome's en-IN model.
  const [srLang, setSrLang] = useState("en-IN");
  // Sarvam female voice — HR picks from the modal dropdown, sent
  // through on every /speak call.
  const [voice, setVoice] = useState("pooja");
  // Speaking state — drives the avatar pulse ring animation. True
  // while Deepthi's audio element is playing; false when idle.
  const [speaking, setSpeaking] = useState(false);
  // If /public/deepthi.jpg is missing we fall back to a "D" glyph.
  const [avatarLoaded, setAvatarLoaded] = useState(true);
  // Generated job-post image URL — set after clicking "Generate post".
  const [postImageUrl, setPostImageUrl] = useState(null);
  const [postBusy, setPostBusy] = useState(false);

  const recogRef = useRef(null);
  const historyRef = useRef([]);
  historyRef.current = history;
  // Retry counter for "no-speech" errors — Chrome sometimes fires
  // that immediately if the mic warm-up is slow; one silent retry
  // hides the flake from HR.
  const noSpeechRetryRef = useRef(0);
  // The one <audio> element that plays every server-synth reply.
  // Kept in a ref so we can cancel a queued reply if HR starts
  // speaking again — no barge-in weirdness.
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);   // blob URL, revoked on next play

  /**
   * Server-side female voice via Sarvam AI (Bulbul).
   *
   * `loud` = false  → normal in-conversation reply. Silent on failure
   *                   so HR is never blocked by a TTS glitch.
   * `loud` = true   → the "Test voice" button. Surface any error
   *                   inline so we can debug Sarvam config quickly.
   */
  const speakServer = async (text, lang = "en-IN", opts = {}) => {
    const { loud = false } = opts;
    if (!text || !text.trim()) return;
    stopServerAudio();
    try {
      const res = await API.post(
        "/recruitment/voice-agent/speak",
        { text, language: lang, voice },
        { responseType: "blob" },
      );

      // Server can send back a JSON error body even on 200-family
      // fast paths; sniff for that.
      const type = res.headers?.["content-type"] || "";
      if (type.includes("application/json")) {
        const asText = await (res.data instanceof Blob
          ? res.data.text()
          : Promise.resolve(String(res.data)));
        throw new Error(asText.slice(0, 300));
      }

      const blob = res.data instanceof Blob
        ? res.data
        : new Blob([res.data], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const el = new Audio(url);
      audioRef.current = el;
      el.onplay = () => setSpeaking(true);
      el.onpause = () => setSpeaking(false);
      el.onended = () => {
        setSpeaking(false);
        try { URL.revokeObjectURL(url); } catch { }
        if (audioUrlRef.current === url) audioUrlRef.current = null;
      };
      el.onerror = () => setSpeaking(false);
      await el.play().catch((err) => {
        setSpeaking(false);
        if (loud) throw new Error("Browser blocked audio autoplay — click Deepthi again.");
      });
    } catch (e) {
      if (loud) {
        // Try to extract Sarvam's actual error out of the axios
        // error blob (blob → text → detail).
        let detail = e?.message || "Voice failed";
        try {
          if (e?.response?.data instanceof Blob) {
            detail = await e.response.data.text();
          } else if (e?.response?.data?.detail) {
            detail = e.response.data.detail;
          }
        } catch { }
        setError(`Voice failed · ${String(detail).slice(0, 400)}`);
      }
    }
  };

  const stopServerAudio = () => {
    try {
      const a = audioRef.current;
      if (a) { a.pause(); a.currentTime = 0; }
    } catch { }
    try {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    } catch { }
    audioUrlRef.current = null;
    audioRef.current = null;
    setSpeaking(false);
  };

  // Cleanup on unmount — stop any playback + recognition.
  useEffect(() => {
    return () => {
      stopServerAudio();
      try { recogRef.current?.stop(); } catch { }
      if (postImageUrl) {
        try { URL.revokeObjectURL(postImageUrl); } catch { }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Generate a branded WE'RE HIRING PNG from the current draft.
  // HR can then download it and post to LinkedIn / Naukri /
  // WhatsApp groups without leaving the ERP.
  const generatePostImage = async () => {
    if (!draft?.POSITION_TITLE) return;
    setPostBusy(true);
    setError("");
    try {
      if (postImageUrl) {
        try { URL.revokeObjectURL(postImageUrl); } catch { }
      }
      const res = await API.post(
        "/recruitment/voice-agent/post-image",
        {
          POSITION_TITLE: draft.POSITION_TITLE,
          DEPARTMENT: draft.DEPARTMENT,
          LOCATION: draft.LOCATION || "Coimbatore, Tamil Nadu",
          EMPLOYMENT_TYPE: draft.EMPLOYMENT_TYPE || "FULL_TIME",
          HEADCOUNT: Number(draft.HEADCOUNT) || 1,
          EXPERIENCE_MIN_YEARS: draft.EXPERIENCE_MIN_YEARS ?? 0,
          EXPERIENCE_MAX_YEARS: draft.EXPERIENCE_MAX_YEARS ?? null,
          BUDGET_CTC_MIN: draft.BUDGET_CTC_MIN ?? null,
          BUDGET_CTC_MAX: draft.BUDGET_CTC_MAX ?? null,
          REQUIRED_SKILLS: draft.REQUIRED_SKILLS || null,
          PREFERRED_SKILLS: draft.PREFERRED_SKILLS || null,
          REQUIRED_EDUCATION: draft.REQUIRED_EDUCATION || null,
          NEEDED_BY_DATE: draft.NEEDED_BY_DATE || null,
          JUSTIFICATION: draft.JUSTIFICATION || null,
          URGENCY: draft.URGENCY || "NORMAL",
        },
        { responseType: "blob" },
      );
      const blob = res.data instanceof Blob
        ? res.data : new Blob([res.data], { type: "image/png" });
      setPostImageUrl(URL.createObjectURL(blob));
    } catch (e) {
      let msg = e?.response?.data?.detail || e?.message || "Could not generate post image.";
      if (e?.response?.data instanceof Blob) {
        try { msg = await e.response.data.text(); } catch { }
      }
      setError(`Post generation failed · ${String(msg).slice(0, 300)}`);
    } finally {
      setPostBusy(false);
    }
  };

  const downloadPostImage = () => {
    if (!postImageUrl || !draft) return;
    const a = document.createElement("a");
    a.href = postImageUrl;
    const slug = (draft.POSITION_TITLE || "role")
      .trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    a.download = `bvc24-hiring-${slug}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Check Web Speech support once. We skip the auto-greeting —
  // Chrome's autoplay policy blocks HTMLAudioElement.play() before
  // the first user gesture, so the greeting silently fails. HR
  // clicks Test voice (or the mic) to hear the first line — that
  // click also unlocks every subsequent audio play.
  useEffect(() => {
    const rec = getRecognition();
    if (!rec) {
      setSupported(false);
      setError("Your browser doesn't support voice input. Use Chrome or Edge — or type your request in the box below.");
    }
  }, []);


  // -----------------------------------------------------------------
  // Send an utterance to the agent
  // -----------------------------------------------------------------
  const sendToAgent = async (utterance) => {
    if (!utterance.trim()) return;
    setError("");

    // If a draft is on screen AND the user says a confirm-word,
    // commit directly without another LLM round-trip.
    if (draft) {
      const lower = utterance.toLowerCase();
      if (CONFIRM_TRIGGERS.some((w) => lower.includes(w))) {
        commit();
        return;
      }
      if (CANCEL_TRIGGERS.some((w) => lower.includes(w))) {
        speakServer("Cancelled. Nothing was created.", "en-IN");
        setDraft(null);
        return;
      }
    }

    setHistory((h) => [...h, { role: "user", content: utterance }]);
    setThinking(true);

    try {
      const res = await API.post("/recruitment/voice-agent/interpret", {
        utterance,
        history: historyRef.current,
      });
      const { reply, action, draft: newDraft, provider: prov } = res.data || {};

      setProvider(prov || "");
      setHistory((h) => [...h, { role: "assistant", content: reply || "" }]);

      if (action === "PROPOSE_DRAFT" && newDraft) {
        setDraft(newDraft);
      }

      if (reply) {
        speakServer(reply, detectLang(reply));
      }
    } catch (e) {
      setError(e?.response?.data?.detail || "Agent failed to reply.");
    } finally {
      setThinking(false);
    }
  };


  // -----------------------------------------------------------------
  // Start / stop listening
  // -----------------------------------------------------------------
  const startListening = (opts = {}) => {
    const { isRetry = false } = opts;
    if (!supported) return;

    if (!isRetry) {
      setInterim("");
      setError("");
      noSpeechRetryRef.current = 0;
    }
    // Barge-in — if the agent is still speaking, cut it off so
    // the mic doesn't pick up its own voice.
    stopServerAudio();

    const rec = getRecognition();
    if (!rec) return;
    rec.lang = srLang;               // user picks — en-IN / ta-IN / hi-IN
    rec.interimResults = true;
    // continuous:true lets HR pause mid-sentence without the browser
    // auto-ending. Chrome still fires onresult with isFinal for each
    // stable segment, so the transcript keeps flowing.
    rec.continuous = true;
    rec.maxAlternatives = 1;

    let finalTranscript = "";
    rec.onresult = (ev) => {
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          finalTranscript += r[0].transcript + " ";
        } else {
          interimText += r[0].transcript;
        }
      }
      setInterim(interimText || finalTranscript);
    };
    rec.onerror = (ev) => {
      const code = ev.error || "unknown";

      // "no-speech" fires when the mic warm-up misses the first
      // 3-5 seconds of audio (very common on Windows Chrome).
      // Silently retry once before showing the error to HR.
      if (code === "no-speech" && noSpeechRetryRef.current === 0) {
        noSpeechRetryRef.current = 1;
        try { rec.stop(); } catch { }
        setTimeout(() => startListening({ isRetry: true }), 200);
        return;
      }

      if (code === "no-speech") {
        setError(
          "I didn't hear anything. Tap the mic and start speaking within " +
          "3 seconds — or type your request below."
        );
      } else if (code === "not-allowed" || code === "service-not-allowed") {
        setError(
          "Mic permission was blocked. Click the padlock in the address " +
          "bar → Site settings → Microphone → Allow, then reload."
        );
      } else if (code === "audio-capture") {
        setError("No microphone detected. Plug one in or use the text box below.");
      } else {
        setError(`Mic error: ${code}. Type below to continue.`);
      }
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      const t = (finalTranscript || interim || "").trim();
      setInterim("");
      if (t) sendToAgent(t);
    };

    recogRef.current = rec;
    setListening(true);
    try { rec.start(); }
    catch (e) {
      setError("Could not start mic — is another tab using it?");
      setListening(false);
    }
  };

  const stopListening = () => {
    try { recogRef.current?.stop(); } catch { }
    setListening(false);
  };


  // -----------------------------------------------------------------
  // Commit the draft
  // -----------------------------------------------------------------
  const commit = async () => {
    if (!draft) return;

    // Guard: critical fields must be present.
    const missing = CRITICAL_FIELDS.filter((k) => !draft[k]);
    if (missing.length) {
      const msg = `Cannot create yet — missing: ${missing.join(", ")}`;
      setError(msg);
      speakServer(msg, "en-IN");
      return;
    }

    setCommitting(true);
    setError("");
    try {
      const payload = {
        POSITION_TITLE: (draft.POSITION_TITLE || "").trim(),
        DEPARTMENT: draft.DEPARTMENT || null,
        LOCATION: draft.LOCATION || "Coimbatore, Tamil Nadu",
        EMPLOYMENT_TYPE: draft.EMPLOYMENT_TYPE || "FULL_TIME",
        HEADCOUNT: Number(draft.HEADCOUNT) || 1,
        EXPERIENCE_MIN_YEARS: draft.EXPERIENCE_MIN_YEARS ?? 0,
        EXPERIENCE_MAX_YEARS: draft.EXPERIENCE_MAX_YEARS ?? null,
        BUDGET_CTC_MIN: draft.BUDGET_CTC_MIN ?? null,
        BUDGET_CTC_MAX: draft.BUDGET_CTC_MAX ?? null,
        REQUIRED_SKILLS: draft.REQUIRED_SKILLS || null,
        PREFERRED_SKILLS: draft.PREFERRED_SKILLS || null,
        REQUIRED_EDUCATION: draft.REQUIRED_EDUCATION || null,
        NEEDED_BY_DATE: draft.NEEDED_BY_DATE || null,
        JUSTIFICATION: draft.JUSTIFICATION || null,
        URGENCY: draft.URGENCY || "NORMAL",
      };
      const res = await API.post("/recruitment/voice-agent/commit", payload);
      speakServer(
        `Requisition ${res.data?.REQ_CODE || ""} created. Approval email has been sent.`,
        "en-IN",
      );
      onCommitted?.(res.data);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Could not create the requisition.";
      setError(msg);
      speakServer(msg, "en-IN");
    } finally {
      setCommitting(false);
    }
  };


  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 950,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 16, width: "100%",
          maxWidth: 640, maxHeight: "min(720px, calc(100vh - 40px))",
          display: "flex", flexDirection: "column",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.35)",
          overflow: "hidden",
        }}
      >

        {/* Header */}
        <div style={{
          padding: "18px 22px 14px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{
              fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4,
              color: BVC_RED, textTransform: "uppercase",
            }}>
              Deepthi · Recruitment voice agent
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, color: "#0f172a",
              marginTop: 4, lineHeight: 1.25,
            }}>
              Speak your hiring request
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              Tamil · English · Thanglish — the agent adapts.
              {provider && <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>{provider}</span></>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 10,
              border: "1px solid #e2e8f0", background: "white",
              color: "#475569", fontSize: 20, cursor: "pointer",
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{
          padding: "18px 22px",
          overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 16,
        }}>

          {/* Deepthi's avatar card — clicking the portrait plays the
              intro line in her voice; the pulse ring animates while
              she's actually speaking (driven by <audio>.onplay).
              Tamil intro sits under her name as a small chip. */}
          <style>{`
            @keyframes deepthi-pulse {
              0%   { box-shadow: 0 0 0 0   rgba(200, 16, 46, 0.55); }
              60%  { box-shadow: 0 0 0 18px rgba(200, 16, 46, 0);   }
              100% { box-shadow: 0 0 0 0   rgba(200, 16, 46, 0);   }
            }
            @media (prefers-reduced-motion: reduce) {
              .deepthi-avatar-pulse { animation: none !important; }
            }
          `}</style>
          <div style={{
            display: "flex", alignItems: "center", gap: 18,
            padding: "18px 18px",
            background: "linear-gradient(135deg, #fef2f2 0%, #fbf6ec 100%)",
            border: "1px solid #e8d9b6",
            borderRadius: 12,
          }}>
            <button
              type="button"
              onClick={() => speakServer(
                "Hi, I am Deepthi, your BVC24 recruitment assistant. I will help you raise hiring requests.",
                "en-IN",
                { loud: true },
              )}
              title="Click to hear Deepthi introduce herself"
              className={speaking ? "deepthi-avatar-pulse" : ""}
              style={{
                width: 88, height: 88, borderRadius: "50%",
                border: `3px solid ${BVC_RED}`,
                background: avatarLoaded
                  ? `url('/deepthi.jpg') center/cover no-repeat`
                  : `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`,
                padding: 0, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden", flexShrink: 0,
                animation: speaking ? "deepthi-pulse 1.4s ease-out infinite" : "none",
                boxShadow: speaking
                  ? "0 0 0 4px rgba(200, 16, 46, 0.20)"
                  : "0 6px 16px rgba(200, 16, 46, 0.20)",
                transition: "box-shadow 0.15s ease",
              }}
            >
              {/* Hidden <img> just to detect if the file is present.
                  If it 404s, we fall back to the initial "D" via
                  the avatarLoaded state and the gradient background. */}
              <img
                src="/deepthi.jpg"
                alt=""
                onError={() => setAvatarLoaded(false)}
                style={{ display: "none" }}
              />
              {!avatarLoaded && (
                <span style={{
                  color: "white", fontSize: 34, fontWeight: 800,
                  letterSpacing: -1, fontFamily: "Georgia, serif",
                }}>D</span>
              )}
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4,
                color: BVC_RED, textTransform: "uppercase",
              }}>
                Meet Deepthi
              </div>
              <div style={{
                fontSize: 20, fontWeight: 700, color: "#0f172a",
                marginTop: 2, lineHeight: 1.2,
              }}>
                {speaking ? "Speaking…" : "Your recruitment agent"}
              </div>
              <div style={{
                fontSize: 12.5, color: "#6d6259",
                marginTop: 4, lineHeight: 1.5,
              }}>
                Tap the portrait to hear her introduce herself, then
                use the mic below to describe a role you want to hire for.
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => speakServer(
                    "வணக்கம், நான் தீப்தி. உங்களுக்கு வேலைவாய்ப்பு கோரிக்கை பதிவு செய்ய உதவுவேன்.",
                    "ta-IN",
                    { loud: true },
                  )}
                  style={{
                    padding: "4px 10px", background: "white",
                    color: BVC_RED, border: `1px solid ${BVC_RED}`,
                    borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                    cursor: "pointer",
                  }}
                  title="Hear Deepthi in Tamil"
                >
                  தமிழில் கேளுங்கள்
                </button>
              </div>
            </div>
          </div>

          {/* Voice picker — HR chooses which Sarvam female voice
              speaks the replies. Also serves as a live audition
              tool via Test voice above. */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 12, color: "#6d6259",
          }}>
            <span style={{ fontWeight: 600, color: "#0f172a" }}>Deepthi's voice:</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              style={{
                padding: "5px 8px", fontSize: 12,
                border: "1px solid #cbd5e1", borderRadius: 6,
                background: "white", color: "#0f172a",
                fontWeight: 500, cursor: "pointer",
              }}
            >
              <optgroup label="Neutral / Professional">
                <option value="priya">Priya · neutral, professional</option>
                <option value="pooja">Pooja · balanced, clear</option>
                <option value="shruti">Shruti · articulate</option>
              </optgroup>
              <optgroup label="Warm / Expressive">
                <option value="kavya">Kavya · warm, expressive</option>
                <option value="ishita">Ishita · soft, empathetic</option>
                <option value="neha">Neha · friendly, casual</option>
              </optgroup>
              <optgroup label="Formal / Mature">
                <option value="shreya">Shreya · formal, corporate</option>
                <option value="kavitha">Kavitha · mature, authoritative</option>
                <option value="suhani">Suhani · composed</option>
              </optgroup>
              <optgroup label="Other">
                <option value="ritu">Ritu</option>
                <option value="simran">Simran</option>
                <option value="roopa">Roopa</option>
                <option value="tanya">Tanya</option>
              </optgroup>
            </select>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              Change &amp; tap Test voice to preview.
            </span>
          </div>

          {/* Big mic button */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button
              onClick={listening ? stopListening : startListening}
              disabled={!supported || thinking || committing}
              title={listening ? "Stop" : "Tap to speak"}
              style={{
                width: 68, height: 68, borderRadius: "50%",
                border: "none",
                background: listening
                  ? `radial-gradient(circle at 30% 30%, #ef4444, #7a1022)`
                  : `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`,
                color: "white",
                cursor: supported ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: listening
                  ? "0 0 0 8px rgba(239, 68, 68, 0.20)"
                  : "0 6px 20px rgba(200, 16, 46, 0.30)",
                transition: "box-shadow 0.15s ease",
                opacity: (thinking || committing) ? 0.6 : 1,
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, color: "#0f172a", fontWeight: 600,
              }}>
                {listening ? "Listening… speak now"
                  : thinking ? "Thinking…"
                    : committing ? "Creating…"
                      : draft ? "Draft ready — say \"confirm\" or press Create"
                        : "Tap the mic and describe the role."}
              </div>
              {interim && (
                <div style={{
                  fontSize: 12.5, color: "#64748b", marginTop: 3,
                  fontStyle: "italic",
                }}>
                  "{interim}"
                </div>
              )}
              {/* Language selector — helps Chrome's transcription
                  when HR is speaking pure Tamil. Default: en-IN
                  (handles English + Thanglish well). */}
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#64748b" }}>
                Language:{" "}
                <select
                  value={srLang}
                  onChange={(e) => setSrLang(e.target.value)}
                  disabled={listening}
                  style={{
                    fontSize: 11.5, padding: "2px 6px",
                    border: "1px solid #cbd5e1", borderRadius: 4,
                    background: "white", color: "#0f172a",
                    cursor: listening ? "not-allowed" : "pointer",
                  }}
                >
                  <option value="en-IN">English / Thanglish (en-IN)</option>
                  <option value="ta-IN">Tamil (ta-IN)</option>
                  <option value="hi-IN">Hindi (hi-IN)</option>
                  <option value="en-US">English (en-US)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Manual input (Firefox fallback + preference override) */}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualInput.trim()) {
                  const t = manualInput.trim();
                  setManualInput("");
                  sendToAgent(t);
                }
              }}
              placeholder="…or type here if you can't use voice"
              style={{
                flex: 1, padding: "9px 12px",
                border: "1px solid #cbd5e1", borderRadius: 8,
                fontSize: 13, background: "white", color: "#0f172a",
              }}
            />
            <button
              onClick={() => {
                if (!manualInput.trim()) return;
                const t = manualInput.trim();
                setManualInput("");
                sendToAgent(t);
              }}
              disabled={!manualInput.trim() || thinking}
              style={{
                padding: "9px 14px", background: "white",
                border: "1px solid #cbd5e1", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                color: "#475569",
                opacity: (!manualInput.trim() || thinking) ? 0.5 : 1,
              }}
            >Send</button>
          </div>

          {/* Conversation strip */}
          {history.length > 0 && (
            <div style={{
              maxHeight: 180, overflowY: "auto",
              padding: "10px 12px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0", borderRadius: 10,
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              {history.slice(-8).map((t, i) => (
                <div key={i} style={{
                  fontSize: 12.5, lineHeight: 1.5,
                  color: t.role === "user" ? "#0f172a" : BVC_DARK,
                }}>
                  <span style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 10, letterSpacing: 0.4,
                    textTransform: "uppercase",
                    color: t.role === "user" ? "#64748b" : BVC_RED,
                    marginRight: 8,
                  }}>
                    {t.role === "user" ? "You" : "Agent"}
                  </span>
                  {t.content}
                </div>
              ))}
            </div>
          )}

          {/* Draft preview */}
          {draft && (
            <div style={{
              padding: 16,
              background: "#fef2f2",
              border: `1px solid ${BVC_GOLD}`,
              borderLeft: `4px solid ${BVC_RED}`,
              borderRadius: 10,
            }}>
              <div style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4,
                color: BVC_RED, textTransform: "uppercase", marginBottom: 10,
              }}>
                Draft requisition
              </div>
              {/* All fields editable — HR corrects anything the
                  agent missed or misheard before generating the
                  post / creating the requisition. */}
              {(() => {
                const set = (k) => (v) => setDraft({ ...draft, [k]: v });
                return (
                  <>
                    <DraftRow label="Position" value={draft.POSITION_TITLE} onChange={set("POSITION_TITLE")} placeholder="e.g. Assembly Technician" />
                    <DraftRow label="Department" value={draft.DEPARTMENT} onChange={set("DEPARTMENT")} placeholder="e.g. Production" />
                    <DraftRow label="Headcount" value={draft.HEADCOUNT} onChange={set("HEADCOUNT")} type="number" placeholder="1" />
                    <DraftRow label="Exp. min (yr)" value={draft.EXPERIENCE_MIN_YEARS ?? ""} onChange={set("EXPERIENCE_MIN_YEARS")} type="number" placeholder="0" />
                    <DraftRow label="Exp. max (yr)" value={draft.EXPERIENCE_MAX_YEARS ?? ""} onChange={set("EXPERIENCE_MAX_YEARS")} type="number" placeholder="(open)" />
                    <DraftRow label="CTC min (₹)" value={draft.BUDGET_CTC_MIN ?? ""} onChange={set("BUDGET_CTC_MIN")} type="number" placeholder="240000" />
                    <DraftRow label="CTC max (₹)" value={draft.BUDGET_CTC_MAX ?? ""} onChange={set("BUDGET_CTC_MAX")} type="number" placeholder="420000" />
                    <DraftRow label="Education" value={draft.REQUIRED_EDUCATION} onChange={set("REQUIRED_EDUCATION")} placeholder="e.g. Diploma / ITI" />
                    <DraftRow label="Skills" value={draft.REQUIRED_SKILLS} onChange={set("REQUIRED_SKILLS")} placeholder="comma, separated, skills" />
                    <DraftRow label="Good to have" value={draft.PREFERRED_SKILLS} onChange={set("PREFERRED_SKILLS")} placeholder="comma, separated" />
                    <DraftRow label="Needed by" value={draft.NEEDED_BY_DATE} onChange={set("NEEDED_BY_DATE")} type="date" />
                    <DraftRow label="Justification" value={draft.JUSTIFICATION} onChange={set("JUSTIFICATION")} placeholder="business reason" />
                    <DraftRow label="Location" value={draft.LOCATION} onChange={set("LOCATION")} placeholder="Coimbatore, Tamil Nadu" />
                    <DraftRow label="Type" value={draft.EMPLOYMENT_TYPE} onChange={set("EMPLOYMENT_TYPE")} placeholder="FULL_TIME" />
                    <DraftRow label="Urgency" value={draft.URGENCY} onChange={set("URGENCY")} placeholder="NORMAL / HIGH / URGENT" />
                  </>
                );
              })()}

              {/* Generate + preview a WE'RE HIRING social post from
                  the current draft. HR downloads it and drops it
                  onto LinkedIn / Naukri / WhatsApp groups. */}
              <div style={{
                marginTop: 14, paddingTop: 14,
                borderTop: `1px dashed ${BVC_GOLD}`,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  marginBottom: postImageUrl ? 12 : 0,
                  flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, fontSize: 12.5, color: "#6d6259", lineHeight: 1.4 }}>
                    <b style={{ color: "#0f172a" }}>Share this role.</b> Generate
                    a branded WE'RE HIRING post — post it to LinkedIn,
                    Naukri, or a WhatsApp group.
                  </div>
                  <button
                    type="button"
                    onClick={generatePostImage}
                    disabled={postBusy}
                    style={{
                      padding: "8px 14px", background: "white",
                      color: BVC_RED, border: `1.5px solid ${BVC_RED}`,
                      borderRadius: 8, fontSize: 12, fontWeight: 700,
                      cursor: postBusy ? "not-allowed" : "pointer",
                      display: "inline-flex", alignItems: "center", gap: 6,
                      whiteSpace: "nowrap", opacity: postBusy ? 0.6 : 1,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    {postBusy
                      ? "Generating…"
                      : (postImageUrl ? "Regenerate" : "Generate post")}
                  </button>
                  {postImageUrl && (
                    <button
                      type="button"
                      onClick={downloadPostImage}
                      style={{
                        padding: "8px 14px", background: BVC_RED,
                        color: "white", border: "none",
                        borderRadius: 8, fontSize: 12, fontWeight: 700,
                        cursor: "pointer", display: "inline-flex",
                        alignItems: "center", gap: 6, whiteSpace: "nowrap",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download
                    </button>
                  )}
                </div>

                {postImageUrl && (
                  <div style={{
                    display: "flex", justifyContent: "center",
                    padding: 10,
                    background: "#fbfaf6",
                    border: "1px solid #e6dfd6",
                    borderRadius: 10,
                  }}>
                    <img
                      src={postImageUrl}
                      alt="Generated hiring post preview"
                      style={{
                        maxWidth: "100%",
                        maxHeight: 380,
                        borderRadius: 6,
                        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              color: "#b91c1c",
              fontSize: 12.5,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 22px",
          borderTop: "1px solid #f1f5f9",
          display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 10, background: "white",
        }}>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
            Say <b style={{ color: "#334155" }}>"confirm"</b> or press Create when the draft is ready.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "9px 16px", background: "white",
                border: "1px solid #cbd5e1", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                color: "#475569",
              }}
            >Cancel</button>
            <button
              onClick={commit}
              disabled={!draft || committing}
              style={{
                padding: "9px 18px", background: BVC_RED,
                color: "white", border: "none", borderRadius: 8,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                opacity: (!draft || committing) ? 0.5 : 1,
              }}
            >
              {committing ? "Creating…" : "Create requisition"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function DraftRow({ label, value, onChange, type = "text", placeholder = "" }) {
  const inputStyle = {
    width: "100%", padding: "5px 8px", fontSize: 13,
    border: "1px solid transparent", borderRadius: 5,
    background: "transparent", color: "#0f172a",
    fontWeight: 500, fontFamily: "inherit",
    boxSizing: "border-box",
  };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "110px 1fr",
      gap: 8, padding: "2px 0", fontSize: 13,
      alignItems: "center",
    }}>
      <div style={{ color: "#64748b" }}>{label}</div>
      {onChange ? (
        <input
          type={type}
          value={value == null ? "" : String(value)}
          placeholder={placeholder || "—"}
          onChange={(e) => onChange(type === "number"
            ? (e.target.value === "" ? null : Number(e.target.value))
            : e.target.value)}
          onFocus={(e) => e.target.style.border = "1px solid #cbd5e1"}
          onBlur={(e) => e.target.style.border = "1px solid transparent"}
          style={inputStyle}
        />
      ) : (
        <div style={{ color: "#0f172a", fontWeight: 500, wordBreak: "break-word" }}>
          {value == null || value === "" ? "—" : String(value)}
        </div>
      )}
    </div>
  );
}
