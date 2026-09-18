import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";
import LeaveAvatarStage from "./LeaveAvatarStage";

/* Voice-first leave assistant.

   Sits at the bottom of the /apply-leave page. Uses the browser Web
   Speech API for input (SpeechRecognition), and the server-side Sarvam
   AI Bulbul v3 female voice for output — the browser's own
   speechSynthesis is deliberately NOT used, because it sounds robotic
   and butchers Tamil / Thanglish.

   Talks to POST /leave-ai-chat/message, POST /leave-ai-chat/speak
   (Sarvam TTS), and POST /leave-ai-chat/submit on confirmation.

   Design notes:

   - Nothing above the existing Apply Leave form is touched. This
     component is fully additive.
   - When the AI proposes a leave draft, we do NOT auto-submit. We
     read the summary aloud, show a Confirm/Cancel bar, and only
     POST /submit after explicit user confirmation.
   - Language pill toggle controls the recognition locale. Reply
     language is auto-detected server-side from the reply text (so a
     Tamil reply speaks in a Tamil voice regardless of the dropdown).
   - Text input is a first-class path — the user can type instead of
     using the mic, useful when the mic isn't available.
*/

const LANGUAGES = [
  { key: "auto",      label: "Auto",     recogLocale: "en-IN", ttsHint: "auto" },
  { key: "en",        label: "English",  recogLocale: "en-IN", ttsHint: "en" },
  { key: "ta",        label: "தமிழ்",     recogLocale: "ta-IN", ttsHint: "ta" },
  { key: "thanglish", label: "Thanglish", recogLocale: "en-IN", ttsHint: "thanglish" },
];

function useSpeechRecognition() {

  const RecognitionCtor =
    (typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
    null;

  return RecognitionCtor;
}

// Server-side Sarvam TTS player. Any in-flight audio is cancelled
// before starting the next reply so overlapping utterances don't
// stack up when the user talks fast.
//
// Returns a controller with `stop()` — the component uses it to
// silence playback when the panel closes or the mute toggle is hit.
//
// A small pub-sub — components can subscribe to know when playback
// starts / ends so the Priya avatar can pulse while she's speaking.
let _currentAudio = null;
let _currentUrl = null;
const _speakingListeners = new Set();
function onSpeakingChange(cb) {
  _speakingListeners.add(cb);
  return () => _speakingListeners.delete(cb);
}
function _emitSpeaking(v) {
  for (const cb of _speakingListeners) { try { cb(v); } catch (_) {} }
}

function stopSpeaking() {
  try {
    if (_currentAudio) {
      _currentAudio.pause();
      _currentAudio.src = "";
    }
  } catch (_) { /* noop */ }
  try {
    if (_currentUrl) URL.revokeObjectURL(_currentUrl);
  } catch (_) { /* noop */ }
  _currentAudio = null;
  _currentUrl = null;
  _emitSpeaking(false);
}

async function speakViaSarvam(text, langHint, voice) {

  if (!text || !text.trim()) return;

  stopSpeaking();

  try {
    const res = await API.post(
      "/leave-ai-chat/speak",
      {
        text,
        language: langHint || "auto",   // server auto-detects on 'auto'
        voice:    voice || undefined,   // undefined → SARVAM_VOICE env default
      },
      {
        responseType: "blob",
        timeout: 25000,
      }
    );

    // A 502/503 with JSON error body slips through axios as a blob;
    // sniff for that so we don't try to play "not configured" text
    // as audio.
    if (!res.data || !res.data.size || !String(res.data.type).startsWith("audio")) {
      return;
    }

    const url = URL.createObjectURL(res.data);
    const audio = new Audio(url);

    _currentAudio = audio;
    _currentUrl = url;

    // Broadcast speaking state so the Priya avatar can pulse
    // exactly while she's speaking, not just while a request is
    // in flight.
    audio.onplay  = () => _emitSpeaking(true);
    audio.onpause = () => _emitSpeaking(false);
    audio.onended = () => {
      _emitSpeaking(false);
      if (_currentUrl === url) {
        URL.revokeObjectURL(url);
        _currentAudio = null;
        _currentUrl = null;
      }
    };

    // Some browsers block autoplay until a user gesture. That's fine —
    // the mic / send button click IS a gesture, so this normally
    // plays. If it doesn't, we swallow the rejection quietly.
    await audio.play().catch(() => { _emitSpeaking(false); });
  } catch (_) {
    // Sarvam unreachable / server down / no key — chat still works,
    // text reply is already on screen. Voice is a nice-to-have.
  }
}


// Circular avatar with graceful <img> → initial fallback.
// Used on both the collapsed FAB bubble AND the expanded panel
// header. `speaking` adds the red pulse ring while Sarvam TTS
// audio is actively playing.
function AvatarFace({ src, initial = "P", size = 72, speaking = false, bordered = false }) {
  const [broken, setBroken] = useState(false);
  const dims = { width: size, height: size };
  const commonWrap = {
    ...dims,
    borderRadius: "50%",
    overflow: "hidden",
    background: "linear-gradient(135deg,#7A1022,#dc2626)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: Math.round(size * 0.45),
    letterSpacing: 0.5,
    border: bordered ? "2px solid #fff" : "none",
    boxShadow: bordered ? "0 0 0 1px rgba(0,0,0,0.08)" : "none",
    flexShrink: 0,
  };
  return (
    <div
      className={`priya-face ${speaking ? "speaking" : ""}`}
      style={commonWrap}
    >
      {(!src || broken) ? initial : (
        <img
          src={src}
          alt={initial}
          onError={() => setBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
    </div>
  );
}


export default function LeaveAIAssistant({ employeeId, onLeaveSubmitted }) {

  // Voice INPUT — now uses MediaRecorder → server-side Sarvam ASR
  // (matches the Recruitment page). Browser Web Speech Recognition
  // was replaced because (a) it needs internet to Google's servers,
  // (b) it butchers Tamil/Thanglish, and (c) Sarvam auto-detects
  // language so the user can say anything in any language.
  //
  // MediaRecorder + getUserMedia both need a secure context —
  // HTTPS or localhost. Over plain http://<LAN-IP> Chrome will
  // block the mic; user has to whitelist the origin in
  //   chrome://flags/#unsafely-treat-insecure-origin-as-secure
  // or serve over HTTPS. Text input path always works regardless.
  const micSupported = typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && !!window.MediaRecorder;
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef   = useRef(null);
  const audioChunksRef   = useRef([]);

  // Avatar name + image. `/priya.png` should be a square (256x256+)
  // portrait dropped into frontend/public/. If it's missing the avatar
  // gracefully falls back to a gradient circle with the initial 'P'.
  // Named after the default Sarvam voice for consistency.
  const AGENT_NAME  = "Priya";
  const AGENT_ROLE  = "Leave Assistant";
  const AVATAR_SRC  = "/priyaa.jpg";
  const AVATAR_INITIAL = "P";

  // Pulse the avatar while Sarvam TTS is actively speaking.
  const [speaking, setSpeakingState] = useState(false);
  useEffect(() => onSpeakingChange(setSpeakingState), []);
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("auto");
  // Mute toggle — persisted per browser so a returning employee
  // doesn't have to re-mute every visit.
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem("leave_ai_muted") === "1"; }
    catch (_) { return false; }
  });
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm your leave assistant. You can type below, or press the mic if " +
        "your device has one. Try 'I need one day casual leave tomorrow' — " +
        "or say it in Tamil / Thanglish, I'll reply in the same language.",
    },
  ]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const chatEndRef = useRef(null);

  const activeLang = useMemo(
    () => LANGUAGES.find((l) => l.key === language) || LANGUAGES[0],
    [language]
  );

  // Persist the mute preference AND stop any in-flight audio when
  // the user hits mute mid-reply.
  useEffect(() => {
    try { localStorage.setItem("leave_ai_muted", muted ? "1" : "0"); }
    catch (_) { /* private mode */ }
    if (muted) stopSpeaking();
  }, [muted]);

  // Silence audio when the panel is closed.
  useEffect(() => {
    if (!open) stopSpeaking();
  }, [open]);

  // Welcome speech — speak the initial greeting the FIRST time the
  // stage opens in a browser session. Language follows the current
  // pill: Tamil pill → Tamil greeting, English → English, Auto/
  // Thanglish → warm Thanglish. Guarded by a ref so it never repeats
  // even if the user closes + reopens; the message row is already in
  // `messages` so a duplicate would feel weird.
  const welcomeSaidRef = useRef(false);
  useEffect(() => {
    if (!open || welcomeSaidRef.current || muted) return;
    // Small delay so <audio>.play() lands after the user's click
    // (the click is the required user gesture for autoplay).
    const t = setTimeout(() => {
      const greeting =
        language === "ta"
          ? "வணக்கம், நான் ப்ரியா. உங்கள் லீவ் அசிஸ்டன்ட். எப்படி உதவலாம்?"
          : language === "thanglish"
          ? "Vanakkam, naan Priya. Ungala leave apply pandradhukum, questions kekurudhukum help pannuven."
          : language === "en"
          ? "Hi, I'm Priya, your leave assistant. Tell me what you need — apply for leave, check your balance, or ask about your tasks."
          : "Hi, I'm Priya. Naan ungala leave assistant. Tell me what you need — Tamil, English, Thanglish anything works.";
      speakViaSarvam(greeting, language === "ta" ? "ta" : language === "en" ? "en" : "auto");
      welcomeSaidRef.current = true;
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scroll to bottom on new message.
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, pendingDraft, thinking]);

  // Central "say this out loud" helper — respects the mute toggle.
  const say = (text) => {
    if (muted) return;
    speakViaSarvam(text, activeLang.ttsHint);
  };

  // ---- Mic → Sarvam ASR flow ----
  //
  // Click mic → getUserMedia → MediaRecorder starts collecting audio
  // chunks. Click again → recorder stops → we bundle chunks into one
  // Blob → POST to /leave-ai-chat/transcribe → server returns text
  // (auto-detected language) → we feed that into sendMessage() like
  // any typed input, so the rest of the pipeline is unchanged.
  const startListening = async () => {
    if (!micSupported) {
      setError("Mic not supported here. Use Chrome/Edge over HTTPS or on localhost.");
      return;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Prefer opus in webm (small + Sarvam-compatible). Fall back to
      // whatever the browser gives us if that's not supported.
      let mime = "audio/webm;codecs=opus";
      if (!window.MediaRecorder.isTypeSupported(mime)) {
        mime = window.MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      }
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      audioChunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        // Release the mic ASAP so the browser tab icon stops recording
        try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()); } catch (_) {}
        mediaStreamRef.current = null;

        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (!chunks.length) { setListening(false); return; }

        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        // Empirical thresholds from opus @ ~24kbps:
        //   ~1 KB  = <0.5s   → tap-release, no speech captured
        //   ~4 KB  = ~1.5s   → one very short word, Sarvam usually can't lock language
        //   ~8 KB+ = ~3s+    → reliable full sentence
        if (blob.size < 4000) {
          setError("That was too short — hold the mic, speak for 2-3 seconds, then release.");
          setListening(false);
          return;
        }

        setListening(false);
        setThinking(true);
        try {
          const fd = new FormData();
          fd.append("file", blob, "voice.webm");
          // Sarvam auto-detect is unreliable on short clips. Pass a
          // concrete hint whenever we can:
          //   Tamil pill        → ta-IN
          //   Thanglish pill    → ta-IN (Tamil transliterated, still Tamil ASR)
          //   English pill      → en-IN
          //   Auto pill (default) → en-IN too (most first turns are English)
          //                         — server will retry with ta-IN if English
          //                         doesn't transcribe. Safer than 'unknown'.
          const hint = activeLang.key === "ta"        ? "ta-IN"
                     : activeLang.key === "thanglish" ? "ta-IN"
                     : "en-IN";
          fd.append("language", hint);

          const res = await API.post("/leave-ai-chat/transcribe", fd, {
            headers: { "Content-Type": "multipart/form-data" },
            timeout: 30000,
          });
          const transcript = (res.data?.transcript || "").trim();
          if (!transcript) {
            setError("Didn't catch that — try again a bit louder.");
            return;
          }
          setInput(transcript);
          sendMessage(transcript);
        } catch (e) {
          const msg = e?.response?.data?.detail
                   || e?.message
                   || "Voice transcription failed. Try typing instead.";
          setError(msg);
        } finally {
          setThinking(false);
        }
      };

      rec.start();
      setListening(true);
    } catch (e) {
      setError(
        e?.name === "NotAllowedError"
          ? "Microphone permission blocked — allow it in the browser's address bar."
          : `Mic error: ${e?.message || e}`
      );
      setListening(false);
    }
  };

  const stopListening = () => {
    try {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();   // triggers onstop above
    } catch (_) { /* noop */ }
  };

  const sendMessage = async (text) => {

    const clean = (text || "").trim();
    if (!clean || !employeeId) return;

    const nextHistory = [...messages, { role: "user", content: clean }];
    setMessages(nextHistory);
    setInput("");
    setThinking(true);
    setError("");
    setPendingDraft(null);

    try {
      const res = await API.post(
        "/leave-ai-chat/message",
        {
          employee_id: employeeId,
          message: clean,
          language: activeLang.key,
          history: nextHistory.slice(0, -1).slice(-20),
        },
        { timeout: 35000 }
      );

      const reply = res.data?.reply || "…";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      say(reply);

      if (res.data?.action === "PROPOSE_LEAVE" && res.data?.draft) {
        setPendingDraft(res.data.draft);
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        "Sorry, I couldn't reach the assistant. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      say(msg);
    } finally {
      setThinking(false);
    }
  };

  const confirmSubmit = async () => {

    if (!pendingDraft || !employeeId) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await API.post("/leave-ai-chat/submit", {
        employee_id: employeeId,
        draft: pendingDraft,
      });

      const confirmation =
        `Done — your ${res.data?.leave_type || pendingDraft.leave_type} leave ` +
        `for ${res.data?.days || pendingDraft.days} day(s) has been sent to your ` +
        `manager for approval.` +
        (res.data?.md_email_sent ? " I've emailed the MD as well." : "");

      setMessages((prev) => [...prev, { role: "assistant", content: confirmation }]);
      say(confirmation);
      setPendingDraft(null);

      if (typeof onLeaveSubmitted === "function") onLeaveSubmitted();

    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        "Sorry, the submission failed. Please try again or use the Apply for Leave form above.";
      setError(msg);
      say(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelDraft = () => {
    setPendingDraft(null);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "Okay, cancelled. Tell me if you'd like to try again.",
      },
    ]);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) sendMessage(input);
  };

  // ==== styles inline so we don't touch existing CSS ====

  const S = {
    fab: {
      position: "fixed",
      bottom: 24,
      right: 24,
      width: 72,
      height: 72,
      borderRadius: "50%",
      background: "#7f1d1d",
      border: "none",
      padding: 0,
      boxShadow: "0 4px 10px rgba(0, 0, 0, 0.25)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9998,
      overflow: "hidden",
      transition: "transform 0.15s ease",
    },
    fabVideo: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      borderRadius: "50%",
      pointerEvents: "none",
      display: "block",
    },
    fabLabel: {
      position: "fixed",
      bottom: 30,
      right: 96,
      background: "#1f2937",
      color: "#ffffff",
      padding: "6px 12px",
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 600,
      whiteSpace: "nowrap",
      zIndex: 9997,
      pointerEvents: "none",
      boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
    },
    overlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.3)",
      zIndex: 9998,
      display: open ? "block" : "none",
    },
    panel: {
      position: "fixed",
      bottom: 24,
      right: 24,
      width: "min(420px, calc(100vw - 32px))",
      maxHeight: "min(640px, calc(100vh - 48px))",
      display: open ? "flex" : "none",
      flexDirection: "column",
      background: "var(--card-bg, #ffffff)",
      border: "1px solid var(--border, #e5e7eb)",
      borderRadius: 16,
      boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
      overflow: "hidden",
      zIndex: 9999,
      animation: "leaveAiSlideUp 0.2s ease-out",
    },
    card: {
      background: "var(--card-bg, #ffffff)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      flex: 1,
      minHeight: 0,
    },
    closeBtn: {
      background: "transparent",
      border: "none",
      color: "#ffffff",
      fontSize: 22,
      cursor: "pointer",
      padding: 4,
      lineHeight: 1,
    },
    muteBtn: {
      background: "rgba(255,255,255,0.15)",
      border: "1px solid rgba(255,255,255,0.35)",
      color: "#ffffff",
      width: 32,
      height: 32,
      borderRadius: "50%",
      cursor: "pointer",
      padding: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    header: {
      padding: "14px 20px",
      background: "linear-gradient(90deg, #dc2626, #b91c1c)",
      color: "#ffffff",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    },
    title: { fontWeight: 700, fontSize: 15, letterSpacing: 0.2 },
    subtitle: { fontSize: 12, opacity: 0.9 },
    langBar: { display: "flex", gap: 6 },
    langPill: (active) => ({
      padding: "4px 10px",
      borderRadius: 999,
      background: active ? "#ffffff" : "rgba(255,255,255,0.15)",
      color: active ? "#dc2626" : "#ffffff",
      border: "1px solid rgba(255,255,255,0.35)",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
    }),
    body: {
      padding: 16,
      background: "var(--surface, #fafafa)",
      flex: 1,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
    },
    log: {
      flex: 1,
      minHeight: 160,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      padding: "8px 4px 12px 4px",
    },
    row: (isUser) => ({
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
    }),
    bubble: (isUser) => ({
      maxWidth: "78%",
      padding: "10px 14px",
      borderRadius: 14,
      background: isUser ? "#dc2626" : "var(--card-bg, #ffffff)",
      color: isUser ? "#ffffff" : "var(--text, #1f2937)",
      border: isUser ? "none" : "1px solid var(--border, #e5e7eb)",
      fontSize: 14,
      lineHeight: 1.45,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    }),
    thinkingRow: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 12px",
      color: "var(--text-secondary, #6b7280)",
      fontSize: 13,
      fontStyle: "italic",
    },
    inputRow: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
    },
    input: {
      flex: 1,
      padding: "10px 14px",
      border: "1px solid var(--border, #d1d5db)",
      borderRadius: 999,
      background: "var(--card-bg, #ffffff)",
      color: "inherit",
      fontSize: 14,
      outline: "none",
    },
    micBtn: (active) => ({
      width: 46,
      height: 46,
      borderRadius: "50%",
      border: "none",
      background: "#dc2626",
      color: "#ffffff",
      boxShadow: active
        ? "0 0 0 6px rgba(220,38,38,0.25), 0 2px 6px rgba(0,0,0,0.15)"
        : "0 2px 6px rgba(0,0,0,0.15)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all 0.15s ease",
      padding: 0,
    }),
    sendBtn: {
      padding: "10px 18px",
      borderRadius: 999,
      border: "none",
      background: "#dc2626",
      color: "#ffffff",
      fontWeight: 600,
      fontSize: 14,
      cursor: "pointer",
    },
    draftPanel: {
      marginTop: 12,
      padding: 14,
      borderRadius: 10,
      border: "1px solid #fca5a5",
      background: "#fef2f2",
      color: "#7f1d1d",
    },
    draftTitle: {
      fontWeight: 700,
      marginBottom: 8,
      fontSize: 14,
      color: "#dc2626",
    },
    draftField: {
      display: "grid",
      gridTemplateColumns: "120px 1fr",
      gap: 8,
      fontSize: 13,
      lineHeight: 1.6,
    },
    draftActions: {
      display: "flex",
      gap: 8,
      marginTop: 12,
      justifyContent: "flex-end",
    },
    confirmBtn: {
      padding: "8px 16px",
      borderRadius: 8,
      border: "none",
      background: "#16a34a",
      color: "#ffffff",
      fontWeight: 600,
      cursor: "pointer",
    },
    cancelBtn: {
      padding: "8px 16px",
      borderRadius: 8,
      border: "1px solid #d1d5db",
      background: "#ffffff",
      color: "#374151",
      fontWeight: 500,
      cursor: "pointer",
    },
    errorBanner: {
      marginTop: 10,
      padding: "8px 12px",
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#b91c1c",
      borderRadius: 8,
      fontSize: 13,
    },
    footNote: {
      marginTop: 10,
      fontSize: 12,
      color: "var(--text-secondary, #6b7280)",
    },
  };

  return (
    <>
      <style>{`
        @keyframes leaveAiSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes priyaSpeakingRing {
          0%   { box-shadow: 0 4px 10px rgba(0,0,0,0.25), 0 0 0 0 rgba(220,38,38,0.55); }
          70%  { box-shadow: 0 4px 10px rgba(0,0,0,0.25), 0 0 0 14px rgba(220,38,38,0); }
          100% { box-shadow: 0 4px 10px rgba(0,0,0,0.25), 0 0 0 0 rgba(220,38,38,0); }
        }
        .leave-ai-fab:hover { transform: scale(1.08); }
        .leave-ai-fab.speaking { animation: priyaSpeakingRing 1.4s ease-out infinite; }
        .priya-face.speaking  { animation: priyaSpeakingRing 1.4s ease-out infinite; }
      `}</style>

      {!open && (
        <>
          <div style={S.fabLabel} aria-hidden="true">{AGENT_NAME} · {AGENT_ROLE}</div>
          <button
            type="button"
            className={`leave-ai-fab ${speaking ? "speaking" : ""}`}
            style={S.fab}
            onClick={() => setOpen(true)}
            title={`Open ${AGENT_NAME} — Voice Leave Assistant`}
            aria-label={`Open ${AGENT_NAME} — Voice Leave Assistant`}
          >
            <AvatarFace src={AVATAR_SRC} initial={AVATAR_INITIAL} size={72} />
          </button>
        </>
      )}

      {open && (
        <LeaveAvatarStage
          messages={messages}
          input={input}
          listening={listening}
          thinking={thinking}
          speaking={speaking}
          submitting={submitting}
          muted={muted}
          pendingDraft={pendingDraft}
          error={error}
          language={language}
          agentName={AGENT_NAME}
          micSupported={micSupported}
          onClose={() => setOpen(false)}
          onChangeInput={setInput}
          onSendText={(t) => { setInput(""); sendMessage(t); }}
          onStartListening={startListening}
          onStopListening={stopListening}
          onLangChange={setLanguage}
          onToggleMute={() => setMuted((m) => !m)}
          onConfirmDraft={confirmSubmit}
          onCancelDraft={cancelDraft}
        />
      )}
        </>
  );
}
