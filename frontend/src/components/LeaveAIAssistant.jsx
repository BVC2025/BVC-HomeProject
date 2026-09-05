import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";

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
let _currentAudio = null;
let _currentUrl = null;

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

    audio.onended = () => {
      if (_currentUrl === url) {
        URL.revokeObjectURL(url);
        _currentAudio = null;
        _currentUrl = null;
      }
    };

    // Some browsers block autoplay until a user gesture. That's fine —
    // the mic / send button click IS a gesture, so this normally
    // plays. If it doesn't, we swallow the rejection quietly.
    await audio.play().catch(() => { /* autoplay blocked */ });
  } catch (_) {
    // Sarvam unreachable / server down / no key — chat still works,
    // text reply is already on screen. Voice is a nice-to-have.
  }
}


export default function LeaveAIAssistant({ employeeId, onLeaveSubmitted }) {

  const RecognitionCtor = useSpeechRecognition();
  const recognitionRef = useRef(null);

  // Voice OUTPUT works on every browser (server-side Sarvam TTS
  // played back through <audio>), so it's always available. Voice
  // INPUT still needs SpeechRecognition — that gates only the mic
  // button, not the whole component.
  const micSupported = !!RecognitionCtor;
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

  const startListening = () => {

    if (!RecognitionCtor) return;
    setError("");

    const r = new RecognitionCtor();
    r.lang = activeLang.recogLocale;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;

    r.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript || "";
      setInput(transcript);
      setListening(false);
      if (transcript.trim()) sendMessage(transcript);
    };

    r.onerror = (e) => {
      setListening(false);
      setError(`Mic error: ${e.error || "unknown"}. You can also type.`);
    };

    r.onend = () => setListening(false);

    try {
      r.start();
      setListening(true);
      recognitionRef.current = r;
    } catch (_) {
      setListening(false);
    }
  };

  const stopListening = () => {
    try { recognitionRef.current?.stop(); } catch (_) { /* noop */ }
    setListening(false);
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
        .leave-ai-fab:hover { transform: scale(1.08); }
      `}</style>

      {!open && (
        <button
          type="button"
          className="leave-ai-fab"
          style={S.fab}
          onClick={() => setOpen(true)}
          title="Open Voice Leave Assistant"
          aria-label="Open Voice Leave Assistant"
        >
          <video
            src="/Ai%20Chatbot3.mp4"
            style={S.fabVideo}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
          />
        </button>
      )}

      <div style={S.panel} role="dialog" aria-modal="true">
        <div style={S.card}>
          <div style={S.header}>
            <div>
              <div style={S.title}>Voice Leave Assistant</div>
              <div style={S.subtitle}>
                Talk to me — I can apply for leave, answer questions about your balance, and check your tasks.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={S.langBar}>
                {LANGUAGES.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    style={S.langPill(language === l.key)}
                    onClick={() => setLanguage(l.key)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                style={S.muteBtn}
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute voice" : "Mute voice"}
                title={muted ? "Voice muted — click to unmute" : "Mute voice"}
              >
                {muted ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                style={S.closeBtn}
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div style={S.body}>
            {!micSupported && (
              <div style={S.errorBanner}>
                No microphone available in this browser — you can still type below.
                Replies will still be spoken aloud (Sarvam female voice).
              </div>
            )}

            <div style={S.log}>
              {messages.map((m, i) => (
                <div key={i} style={S.row(m.role === "user")}>
                  <div style={S.bubble(m.role === "user")}>{m.content}</div>
                </div>
              ))}
              {thinking && (
                <div style={S.thinkingRow}>Thinking…</div>
              )}
              <div ref={chatEndRef} />
            </div>

            {pendingDraft && (
              <div style={S.draftPanel}>
                <div style={S.draftTitle}>Confirm before sending</div>
                <div style={S.draftField}>
                  <div>Type:</div>       <div>{pendingDraft.leave_type}</div>
                  <div>From:</div>       <div>{pendingDraft.start_date}</div>
                  <div>To:</div>         <div>{pendingDraft.end_date}</div>
                  <div>Days:</div>       <div>{pendingDraft.days ?? "—"}{pendingDraft.half_day ? " (half day)" : ""}</div>
                  <div>Reason:</div>     <div>{pendingDraft.reason || "—"}</div>
                  {(pendingDraft.task_commitments || []).length > 0 && (
                    <>
                      <div>Task commits:</div>
                      <div>
                        {pendingDraft.task_commitments.map((tc, i) => (
                          <div key={i}>• {tc.title} → {tc.promised_completion_date}</div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div style={S.draftActions}>
                  <button type="button" style={S.cancelBtn} onClick={cancelDraft} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="button" style={S.confirmBtn} onClick={confirmSubmit} disabled={submitting}>
                    {submitting ? "Sending…" : "Confirm & Send"}
                  </button>
                </div>
              </div>
            )}

            {error && <div style={S.errorBanner}>{error}</div>}

            <form style={S.inputRow} onSubmit={handleTextSubmit}>
              <button
                type="button"
                style={S.micBtn(listening)}
                onClick={listening ? stopListening : startListening}
                title={listening ? "Stop listening" : "Start listening"}
                disabled={!RecognitionCtor}
                aria-label="Toggle voice input"
              >
                {listening ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <line x1="12" y1="18" x2="12" y2="21" />
                    <line x1="9" y1="21" x2="15" y2="21" />
                  </svg>
                )}
              </button>
              <input
                style={S.input}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  listening
                    ? "Listening…"
                    : "Type your message or press the mic to speak"
                }
                disabled={thinking || submitting}
              />
              <button
                type="submit"
                style={S.sendBtn}
                disabled={!input.trim() || thinking || submitting}
              >
                Send
              </button>
            </form>

            <div style={S.footNote}>
              Nothing is submitted until you say <strong>Confirm &amp; Send</strong>.
              For sensitive HR/admin data, I'll politely decline.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
