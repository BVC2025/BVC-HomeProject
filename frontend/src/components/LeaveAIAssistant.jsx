import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";

/* Voice-first leave assistant.

   Sits at the bottom of the /apply-leave page. Uses the browser Web
   Speech API for both input (SpeechRecognition) and output (SpeechSynthesis).
   Talks to POST /leave-ai-chat/message and, on confirmed leave drafts,
   POST /leave-ai-chat/submit.

   Design notes:

   - Nothing above the existing Apply Leave form is touched. This
     component is fully additive.
   - When the AI proposes a leave draft, we do NOT auto-submit. We
     read the summary aloud, show a Confirm/Cancel bar, and only
     POST /submit after explicit user confirmation.
   - Language pill toggle controls both the recognition locale and the
     TTS voice chosen. "Auto" lets the model decide the reply language.
*/

const LANGUAGES = [
  { key: "auto", label: "Auto", recogLocale: "en-IN", ttsLocaleMatch: /^en/i },
  { key: "en", label: "English", recogLocale: "en-IN", ttsLocaleMatch: /^en/i },
  { key: "ta", label: "தமிழ்", recogLocale: "ta-IN", ttsLocaleMatch: /^ta/i },
  { key: "thanglish", label: "Thanglish", recogLocale: "en-IN", ttsLocaleMatch: /^(en|ta)/i },
];

function useSpeechRecognition() {

  const RecognitionCtor =
    (typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
    null;

  return RecognitionCtor;
}

function speak(text, localeMatch) {

  if (typeof window === "undefined" || !window.speechSynthesis) return;

  try {

    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => localeMatch.test(v.lang));
    if (preferred) utter.voice = preferred;

    window.speechSynthesis.speak(utter);

  } catch (_) { /* voice is a nice-to-have */ }
}


export default function LeaveAIAssistant({ employeeId, onLeaveSubmitted }) {

  const RecognitionCtor = useSpeechRecognition();
  const recognitionRef = useRef(null);

  const [supported] = useState(() => !!RecognitionCtor && !!window.speechSynthesis);
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm your leave assistant. You can talk to me — press the mic and " +
        "say something like 'I need one day casual leave tomorrow'.",
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

  // Scroll to bottom on new message.
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, pendingDraft, thinking]);

  // Warm up TTS voice list — some browsers only populate voices after
  // getVoices is called once.
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
  }, []);

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
      const res = await API.post("/leave-ai-chat/message", {
        employee_id: employeeId,
        message: clean,
        language: activeLang.key,
        history: nextHistory.slice(0, -1).slice(-20),
      });

      const reply = res.data?.reply || "…";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      speak(reply, activeLang.ttsLocaleMatch);

      if (res.data?.action === "PROPOSE_LEAVE" && res.data?.draft) {
        setPendingDraft(res.data.draft);
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        "Sorry, I couldn't reach the assistant. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      speak(msg, activeLang.ttsLocaleMatch);
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
      speak(confirmation, activeLang.ttsLocaleMatch);
      setPendingDraft(null);

      if (typeof onLeaveSubmitted === "function") onLeaveSubmitted();

    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        "Sorry, the submission failed. Please try again or use the Apply for Leave form above.";
      setError(msg);
      speak(msg, activeLang.ttsLocaleMatch);
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
      background: active ? "#dc2626" : "var(--card-bg, #ffffff)",
      color: active ? "#ffffff" : "#dc2626",
      boxShadow: active
        ? "0 0 0 6px rgba(220,38,38,0.15)"
        : "0 2px 4px rgba(0,0,0,0.08)",
      cursor: "pointer",
      fontSize: 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "all 0.15s ease",
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
            {!supported && (
              <div style={S.errorBanner}>
                Your browser doesn't support voice input / output — but you can still type below.
                Chrome or Edge on desktop works best.
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
                {listening ? "⏹" : "🎙"}
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
