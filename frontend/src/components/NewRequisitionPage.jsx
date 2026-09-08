// =====================================================================
// NewRequisitionPage — "Create Job Requisition" experience.
//
// Three equal entry methods (Manual / AI Chat / AI Voice) matching the
// reference layout the user provided. Manual Entry opens the existing,
// already-working CreateRequisitionModal form (untouched) as an overlay
// on top of this page. AI Chat and AI Voice share ONE conversation with
// Deepthi (the same recruitment_voice_agent backend used elsewhere) —
// switching between them mid-conversation preserves history, matching
// the spec's "user can switch between Voice and Chat at any time"
// rule. Voice input is the browser's SpeechRecognition; voice OUTPUT
// is server-side Sarvam TTS (POST /recruitment/voice-agent/speak) —
// same backend calls VoiceRequisitionModal.jsx already uses, just a
// different presentation.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import API from "../services/api";
import styles from "./NewRequisitionPage.module.css";

const CONFIRM_TRIGGERS = [
  "confirm", "yes create", "yes, create", "yes create it",
  "create it", "go ahead", "please create", "submit", "raise it",
  "sari", "seri", "aama", "aamam", "aan", "aanaa", "seri create",
  "seri panunga", "post pannunga", "post panu", "create panu", "create panunga",
];

const CANCEL_TRIGGERS = [
  "cancel", "no cancel", "no not", "stop", "veenam", "vendaam", "vendam", "illa",
];

const SAMPLE_PROMPTS = [
  "I need a React developer with 2 to 4 years experience in Coimbatore.",
  "We need a UI/UX designer, full time, with 3 years experience.",
  "Create a sales executive role for Chennai with 1–2 years experience.",
];

function getRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function detectLang(text) {
  if (!text) return "en-IN";
  if (/[஀-௿]/.test(text)) return "ta-IN";
  if (/[ऀ-ॿ]/.test(text)) return "hi-IN";
  return "en-IN";
}

function fmtMoney(n) {
  if (n == null) return null;
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------
// Icons — inline SVG, no emoji (matches this app's UI-copy convention)
// ---------------------------------------------------------------------
const ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

const I = {
  doc: () => <svg {...ICON}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>,
  chat: () => <svg {...ICON}><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /></svg>,
  mic: (p) => <svg {...ICON} {...p}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>,
  chevronRight: () => <svg {...ICON} width={14} height={14}><path d="M9 6l6 6-6 6" /></svg>,
  chevronDown: () => <svg {...ICON} width={14} height={14}><path d="M6 9l6 6 6-6" /></svg>,
  check: () => <svg {...ICON}><path d="M20 6L9 17l-5-5" /></svg>,
  speaker: () => <svg {...ICON} width={14} height={14}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 8.5a5 5 0 0 1 0 7" /></svg>,
  sparkle: () => <svg {...ICON} width={14} height={14}><path d="M12 3l1.8 4.9L19 9.5l-5.2 1.6L12 16l-1.8-4.9L5 9.5l5.2-1.6z" /></svg>,
  building: () => <svg {...ICON} width={15} height={15}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" /></svg>,
  pin: () => <svg {...ICON} width={15} height={15}><path d="M12 21s-7-6.5-7-11.5A7 7 0 0 1 19 9.5C19 14.5 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>,
  briefcase: () => <svg {...ICON} width={15} height={15}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
  clock: () => <svg {...ICON} width={15} height={15}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  users: () => <svg {...ICON} width={15} height={15}><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" /><circle cx="17" cy="8" r="2.5" /><path d="M23 20c0-2.3-1.6-4.1-4-4.7" /></svg>,
  cash: () => <svg {...ICON} width={15} height={15}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  home: () => <svg {...ICON} width={15} height={15}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>,
  calendar: () => <svg {...ICON} width={15} height={15}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>,
  edit: () => <svg {...ICON} width={14} height={14}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>,
  x: () => <svg {...ICON}><path d="M5 5l14 14M19 5L5 19" /></svg>,
  copy: () => <svg {...ICON} width={14} height={14}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  download: () => <svg {...ICON} width={14} height={14}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
};


export default function NewRequisitionPage({ onClose, onCommitted, onOpenManual }) {

  const [mode, setMode] = useState("voice"); // "voice" | "chat"
  // Sarvam Bulbul v3 female voice roster — user picks; the server
  // whitelists these same names. Persisted per-browser so the user
  // doesn't have to re-pick each visit.
  const [voice, setVoice] = useState(() => {
    try { return localStorage.getItem("recruitment_voice") || "pooja"; }
    catch { return "pooja"; }
  });
  useEffect(() => {
    try { localStorage.setItem("recruitment_voice", voice); } catch { /* noop */ }
  }, [voice]);
  const [supported] = useState(() => !!getRecognition());
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [history, setHistory] = useState([]);
  const [interim, setInterim] = useState("");
  const [lastUtterance, setLastUtterance] = useState("");
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [committedReq, setCommittedReq] = useState(null);
  const [expanded, setExpanded] = useState({ desc: true, resp: true, qual: false });
  const [postImageUrl, setPostImageUrl] = useState(null);
  const [postBusy, setPostBusy] = useState(false);
  const [postTextBusy, setPostTextBusy] = useState(false);
  const [postTextCopied, setPostTextCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState([]);

  const recogRef = useRef(null);
  const historyRef = useRef([]);
  useEffect(() => { historyRef.current = history; }, [history]);
  const noSpeechRetryRef = useRef(0);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const usedVoiceRef = useRef(false);

  useEffect(() => {
    return () => {
      try { recogRef.current?.stop(); } catch { /* ignore */ }
      try { audioRef.current?.pause(); } catch { /* ignore */ }
      if (audioUrlRef.current) { try { URL.revokeObjectURL(audioUrlRef.current); } catch { /* ignore */ } }
      if (postImageUrl) { try { URL.revokeObjectURL(postImageUrl); } catch { /* ignore */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Server voice output (Sarvam) ----
  const speakServer = async (text) => {
    if (!text?.trim()) return;
    try {
      const res = await API.post(
        "/recruitment/voice-agent/speak",
        { text, language: detectLang(text), voice },
        { responseType: "blob" },
      );
      const type = res.headers?.["content-type"] || "";
      if (type.includes("application/json")) return;
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      if (audioUrlRef.current) { try { URL.revokeObjectURL(audioUrlRef.current); } catch { /* ignore */ } }
      audioUrlRef.current = url;
      const el = new Audio(url);
      audioRef.current = el;
      el.play().catch(() => { /* autoplay blocked — silent, non-critical */ });
    } catch { /* voice is best-effort */ }
  };

  // ---- Agent turn ----
  const sendToAgent = async (utterance) => {
    if (!utterance.trim()) return;
    setError("");
    setLastUtterance(utterance);

    if (draft) {
      const lower = utterance.toLowerCase();
      if (CONFIRM_TRIGGERS.some((w) => lower.includes(w))) { commit(); return; }
      if (CANCEL_TRIGGERS.some((w) => lower.includes(w))) {
        setDraft(null);
        speakServer("Cancelled. Nothing was created.");
        return;
      }
    }

    setHistory((h) => [...h, { role: "user", content: utterance }]);
    setThinking(true);
    try {
      const res = await API.post("/recruitment/voice-agent/interpret", {
        utterance, history: historyRef.current,
      });
      const { reply, action, draft: newDraft } = res.data || {};
      setHistory((h) => [...h, { role: "assistant", content: reply || "" }]);
      if (action === "PROPOSE_DRAFT" && newDraft) setDraft(newDraft);
      if (reply) speakServer(reply);
    } catch (e) {
      setError(e?.response?.data?.detail || "Agent failed to reply — please try again.");
    } finally {
      setThinking(false);
    }
  };

  // ---- Mic ----
  const startListening = (opts = {}) => {
    const { isRetry = false } = opts;
    if (!supported) return;
    if (!isRetry) { setInterim(""); setError(""); noSpeechRetryRef.current = 0; }
    try { audioRef.current?.pause(); } catch { /* ignore */ }

    const rec = getRecognition();
    if (!rec) return;
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    let finalTranscript = "";
    rec.onresult = (ev) => {
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalTranscript += r[0].transcript + " ";
        else interimText += r[0].transcript;
      }
      setInterim(interimText || finalTranscript);
    };
    rec.onerror = (ev) => {
      const code = ev.error || "unknown";
      if (code === "no-speech" && noSpeechRetryRef.current === 0) {
        noSpeechRetryRef.current = 1;
        try { rec.stop(); } catch { /* ignore */ }
        setTimeout(() => startListening({ isRetry: true }), 200);
        return;
      }
      if (code === "no-speech") setError("Didn't catch that — tap the mic and try again.");
      else if (code === "not-allowed" || code === "service-not-allowed") setError("Microphone permission blocked — allow it in the browser's address bar.");
      else if (code === "audio-capture") setError("No microphone detected.");
      else setError(`Mic error: ${code}`);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      const t = (finalTranscript || interim || "").trim();
      setInterim("");
      if (t) { usedVoiceRef.current = true; sendToAgent(t); }
    };

    recogRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setError("Could not start the microphone."); setListening(false); }
  };

  const stopListening = () => {
    try { recogRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  };

  // ---- Commit ----
  const commit = async () => {
    if (!draft?.POSITION_TITLE || !draft?.DEPARTMENT) {
      setError("Need at least a role and department before creating.");
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
        WORK_MODE: draft.WORK_MODE || "ON_SITE",
        SHIFT: draft.SHIFT || null,
        SALARY_PERIOD: draft.SALARY_PERIOD || "MONTHLY",
        APPLICATION_DEADLINE: draft.APPLICATION_DEADLINE || null,
        JOB_DESCRIPTION: draft.JOB_DESCRIPTION || null,
        RESPONSIBILITIES: draft.RESPONSIBILITIES || null,
        QUALIFICATIONS: draft.QUALIFICATIONS || null,
        source: usedVoiceRef.current ? "VOICE" : "CHAT",
        original_transcript: historyRef.current
          .map((t) => `${t.role === "user" ? "HR" : "Deepthi"}: ${t.content}`)
          .join("\n") || null,
      };
      const res = await API.post("/recruitment/voice-agent/commit", payload);
      setCommittedReq(res.data);
      speakServer(`Requisition ${res.data?.REQ_CODE || ""} created. Approval email has been sent.`);
      onCommitted?.(res.data);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Could not create the requisition.";
      setError(msg);
    } finally {
      setCommitting(false);
    }
  };

  const draftForExport = () => ({
    POSITION_TITLE: draft?.POSITION_TITLE,
    DEPARTMENT: draft?.DEPARTMENT,
    LOCATION: draft?.LOCATION || "Coimbatore, Tamil Nadu",
    EMPLOYMENT_TYPE: draft?.EMPLOYMENT_TYPE || "FULL_TIME",
    WORK_MODE: draft?.WORK_MODE || "ON_SITE",
    SHIFT: draft?.SHIFT || null,
    HEADCOUNT: Number(draft?.HEADCOUNT) || 1,
    EXPERIENCE_MIN_YEARS: draft?.EXPERIENCE_MIN_YEARS ?? 0,
    EXPERIENCE_MAX_YEARS: draft?.EXPERIENCE_MAX_YEARS ?? null,
    BUDGET_CTC_MIN: draft?.BUDGET_CTC_MIN ?? null,
    BUDGET_CTC_MAX: draft?.BUDGET_CTC_MAX ?? null,
    SALARY_PERIOD: draft?.SALARY_PERIOD || "MONTHLY",
    REQUIRED_SKILLS: draft?.REQUIRED_SKILLS || null,
    PREFERRED_SKILLS: draft?.PREFERRED_SKILLS || null,
    REQUIRED_EDUCATION: draft?.REQUIRED_EDUCATION || null,
    NEEDED_BY_DATE: draft?.NEEDED_BY_DATE || null,
    JUSTIFICATION: draft?.JUSTIFICATION || null,
    URGENCY: draft?.URGENCY || "NORMAL",
    JOB_DESCRIPTION: draft?.JOB_DESCRIPTION || null,
    RESPONSIBILITIES: draft?.RESPONSIBILITIES || null,
    QUALIFICATIONS: draft?.QUALIFICATIONS || null,
  });

  const generatePostImage = async () => {
    if (!draft?.POSITION_TITLE) return;
    setPostBusy(true);
    setError("");
    try {
      if (postImageUrl) { try { URL.revokeObjectURL(postImageUrl); } catch { /* ignore */ } }
      const res = await API.post("/recruitment/voice-agent/post-image", draftForExport(), { responseType: "blob" });
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: "image/png" });
      setPostImageUrl(URL.createObjectURL(blob));
    } catch {
      setError("Could not generate the poster image.");
    } finally {
      setPostBusy(false);
    }
  };

  const copyPostText = async () => {
    if (!draft?.POSITION_TITLE) return;
    setPostTextBusy(true);
    setError("");
    try {
      const res = await API.post("/recruitment/voice-agent/post-text", draftForExport());
      await navigator.clipboard.writeText(res.data?.text || "");
      setPostTextCopied(true);
      setTimeout(() => setPostTextCopied(false), 2500);
    } catch {
      setError("Could not prepare the job post text.");
    } finally {
      setPostTextBusy(false);
    }
  };

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  const skillChips = (val) => (val || "").split(",").map((s) => s.trim()).filter(Boolean);

  const bullets = (text) => (text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);

  const canPublish = !!committedReq;

  const togglePublish = (key) => {
    if (!canPublish) return;
    setPublished((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>

        <div className={styles.topBar}>
          <div className={styles.breadcrumb}>
            <span onClick={onClose}>Recruitment</span>
            <I.chevronRight />
            <span onClick={onClose}>Job Requisitions</span>
            <I.chevronRight />
            <span className={styles.breadcrumbCurrent}>New Requisition</span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <I.x />
          </button>
        </div>

        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Create Job Requisition</h1>
            <p className={styles.subtitle}>Don't want to fill the form? Just tell us what you need.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Sarvam Bulbul v3 female voices — reply reads back in whichever the user picks. */}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 600, color: "#334155" }}>
              <I.speaker />
              Voice:
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                style={{
                  padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1",
                  fontSize: 12, fontWeight: 600, background: "#fff", cursor: "pointer",
                }}
                title="Female voice used for the assistant's spoken reply"
              >
                {["pooja","priya","kavya","shruti","ishita","neha","shreya","kavitha","ritu","simran","roopa","tanya","suhani"].map(v =>
                  <option key={v} value={v}>{v.charAt(0).toUpperCase()+v.slice(1)}</option>
                )}
              </select>
            </label>
            <button
              type="button"
              className={styles.switchBtn}
              onClick={() => setMode((m) => (m === "voice" ? "chat" : "voice"))}
            >
              {mode === "voice" ? <I.chat /> : <I.mic />}
              Switch to {mode === "voice" ? "Chat" : "Voice"}
            </button>
          </div>
        </div>

        <div className={styles.methodCards}>
          <button type="button" className={styles.methodCard} onClick={onOpenManual}>
            <span className={`${styles.methodIcon} ${styles.methodIconNeutral}`}><I.doc /></span>
            <span className={styles.methodTitle}>Manual Entry</span>
            <span className={styles.methodSub}>Fill the form manually</span>
          </button>
          <button
            type="button"
            className={`${styles.methodCard} ${mode === "chat" ? styles.methodCardActive : ""}`}
            onClick={() => setMode("chat")}
          >
            <span className={`${styles.methodIcon} ${styles.methodIconChat}`}><I.chat /></span>
            <span className={styles.methodTitle}>AI Chat</span>
            <span className={styles.methodSub}>Describe through chat</span>
          </button>
          <button
            type="button"
            className={`${styles.methodCard} ${mode === "voice" ? styles.methodCardActive : ""}`}
            onClick={() => setMode("voice")}
          >
            <span className={styles.recommendedBadge}>Recommended</span>
            <span className={`${styles.methodIcon} ${styles.methodIconVoice}`}><I.mic /></span>
            <span className={styles.methodTitle}>AI Voice</span>
            <span className={styles.methodSub}>Speak your requirement</span>
          </button>
        </div>

        <div className={styles.mainGrid}>

          {/* ───────────── LEFT · interaction panel ───────────── */}
          <div className={styles.leftPanel}>
            <h2 className={styles.panelTitle}>
              Create Job Requisition with {mode === "voice" ? "Voice" : "Chat"}
            </h2>
            <p className={styles.panelSub}>
              {mode === "voice"
                ? "Tell me about the position you want to hire for. You can speak naturally in Tamil or English."
                : "Describe the role in your own words — Deepthi will ask for anything important that's missing."}
            </p>

            {mode === "voice" ? (
              <>
                <div className={styles.micWrap}>
                  <button
                    type="button"
                    className={`${styles.micBtn} ${listening ? styles.micBtnListening : ""}`}
                    onClick={listening ? stopListening : () => startListening()}
                    disabled={!supported || thinking || committing}
                  >
                    <I.mic width={30} height={30} />
                  </button>
                </div>

                {listening && (
                  <>
                    <div className={styles.listeningLabel}>Listening…</div>
                    <div className={styles.waveform}>
                      {Array.from({ length: 24 }).map((_, i) => (
                        <span key={i} style={{ animationDelay: `${(i % 8) * 0.08}s` }} />
                      ))}
                    </div>
                  </>
                )}

                {!listening && !supported && (
                  <div className={styles.errorBanner}>
                    Your browser doesn't support voice input — use Chrome/Edge, or switch to Chat.
                  </div>
                )}

                {(interim || lastUtterance) && (
                  <div className={styles.transcriptBox}>
                    <div className={styles.transcriptLabel}>You said:</div>
                    <div className={styles.transcriptText}>
                      "{interim || lastUtterance}"
                      {!listening && lastUtterance && (
                        <button type="button" className={styles.speakerBtn} onClick={() => speakServer(lastUtterance)} aria-label="Replay">
                          <I.speaker />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className={styles.voiceActions}>
                  {listening ? (
                    <button type="button" className={styles.stopBtn} onClick={stopListening}>Stop</button>
                  ) : (
                    <button type="button" className={styles.restartBtn} onClick={() => { setHistory([]); setDraft(null); setLastUtterance(""); setError(""); }}>
                      Restart
                    </button>
                  )}
                </div>

                {/* Text-input fallback for testing when the mic is unavailable
                    (Stereo Mix, no headset, browser mic blocked, etc.). Feeds
                    the same interpret pipeline as the mic. Also a "Test voice"
                    button that just makes Deepthi speak — verifies the Sarvam
                    voice pipeline end-to-end with zero user speech. */}
                <div style={{ marginTop: 14, borderTop: "1px dashed #cbd5e1", paddingTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                    Mic not working? Type instead
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!chatInput.trim() || thinking) return;
                      const t = chatInput.trim();
                      setChatInput("");
                      sendToAgent(t);
                    }}
                    style={{ display: "flex", gap: 6, marginBottom: 8 }}
                  >
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="e.g. Need 2 React devs in Coimbatore, 2-3 yrs, ₹4-6L"
                      disabled={thinking || committing}
                      style={{
                        flex: 1, padding: "8px 12px", borderRadius: 8,
                        border: "1px solid #cbd5e1", fontSize: 13, background: "#fff",
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || thinking || committing}
                      style={{
                        padding: "8px 14px", background: "#7A1022", color: "#fff",
                        border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer",
                      }}
                    >Send</button>
                  </form>
                  <button
                    type="button"
                    onClick={() => speakServer(
                      "Hi, this is Deepthi from BVC24 recruitment. " +
                      "I can hear you clearly. Tell me the role, department, " +
                      "experience and how many people you want to hire."
                    )}
                    style={{
                      padding: "6px 12px", background: "#fff", color: "#7A1022",
                      border: "1px solid #7A1022", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}
                    title="Play a sample Sarvam voice reply to verify audio works"
                  >
                    <I.speaker /> Test voice
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.chatBox}>
                <div className={styles.chatHistory}>
                  {history.length === 0 && (
                    <div className={styles.chatEmpty}>
                      Hi! Tell me what position you're hiring for — I'll create the job requisition for you.
                    </div>
                  )}
                  {history.map((t, i) => (
                    <div key={i} className={t.role === "user" ? styles.chatBubbleUser : styles.chatBubbleBot}>
                      {t.content}
                    </div>
                  ))}
                  {thinking && <div className={styles.chatBubbleBot}>…</div>}
                </div>
                <form
                  className={styles.chatInputRow}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!chatInput.trim() || thinking) return;
                    const t = chatInput.trim();
                    setChatInput("");
                    sendToAgent(t);
                  }}
                >
                  <input
                    className={styles.chatInput}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type your hiring request…"
                  />
                  <button type="submit" className={styles.chatSendBtn} disabled={!chatInput.trim() || thinking}>Send</button>
                </form>
              </div>
            )}

            {error && <div className={styles.errorBanner}>{error}</div>}

            <div className={styles.samplesBox}>
              <div className={styles.samplesTitle}>Want to try a sample?</div>
              <div className={styles.samplesSub}>You can say something like:</div>
              <div className={styles.samplesGrid}>
                {SAMPLE_PROMPTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={styles.sampleChip}
                    onClick={() => sendToAgent(s)}
                  >
                    "{s}"
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ───────────── RIGHT · AI generated requisition ───────────── */}
          <div className={styles.rightPanel}>
            {draft && (
              <div className={styles.successBanner}>
                <span className={styles.successIcon}><I.check /></span>
                I've understood your requirement. Here's the job requisition I've prepared based on your input. Please review and confirm.
              </div>
            )}

            {!draft && (
              <div className={styles.placeholderCard}>
                <span className={styles.placeholderIcon}><I.sparkle /></span>
                Nothing generated yet — {mode === "voice" ? "tap the mic" : "start typing"} and Deepthi will prepare the requisition here.
              </div>
            )}

            {draft && (
              <div className={styles.draftCard}>
                <div className={styles.draftCardHeader}>
                  <span className={styles.draftCardHeaderIcon}><I.sparkle /></span>
                  AI Generated Requisition
                  <span className={styles.aiBadge}>AI</span>
                </div>

                <div className={styles.draftTitleRow}>
                  {editing ? (
                    <input
                      className={styles.titleInput}
                      value={draft.POSITION_TITLE || ""}
                      onChange={(e) => set("POSITION_TITLE")(e.target.value)}
                    />
                  ) : (
                    <span className={styles.draftTitle}>{draft.POSITION_TITLE || "—"}</span>
                  )}
                  <span className={styles.draftBadge}>{committedReq ? committedReq.REQ_CODE : "Draft"}</span>
                </div>

                <div className={styles.factGrid}>
                  <Fact icon={<I.building />} label="Department" value={draft.DEPARTMENT} editing={editing} onChange={set("DEPARTMENT")} />
                  <Fact icon={<I.pin />} label="Location" value={draft.LOCATION} editing={editing} onChange={set("LOCATION")} />
                  <Fact icon={<I.briefcase />} label="Employment Type" value={(draft.EMPLOYMENT_TYPE || "").replace(/_/g, " ")} editing={editing} onChange={set("EMPLOYMENT_TYPE")} />
                  <Fact
                    icon={<I.clock />} label="Experience"
                    value={draft.EXPERIENCE_MIN_YEARS != null ? `${draft.EXPERIENCE_MIN_YEARS}${draft.EXPERIENCE_MAX_YEARS ? `–${draft.EXPERIENCE_MAX_YEARS}` : "+"} Years` : null}
                    editing={false}
                  />
                  <Fact icon={<I.users />} label="Openings" value={draft.HEADCOUNT} editing={editing} onChange={(v) => set("HEADCOUNT")(Number(v) || 1)} />
                  <Fact
                    icon={<I.cash />} label="Salary"
                    value={(draft.BUDGET_CTC_MIN || draft.BUDGET_CTC_MAX)
                      ? `${fmtMoney(draft.BUDGET_CTC_MIN) || ""}${draft.BUDGET_CTC_MIN && draft.BUDGET_CTC_MAX ? " – " : ""}${draft.BUDGET_CTC_MAX ? fmtMoney(draft.BUDGET_CTC_MAX) : ""} / ${(draft.SALARY_PERIOD || "MONTHLY").toLowerCase()}`
                      : null}
                    editing={false}
                  />
                  <Fact icon={<I.home />} label="Work Mode" value={(draft.WORK_MODE || "ON_SITE").replace(/_/g, "-").toLowerCase()} editing={editing} onChange={set("WORK_MODE")} />
                  <Fact icon={<I.calendar />} label="Joining Timeline" value={draft.NEEDED_BY_DATE ? `By ${draft.NEEDED_BY_DATE}` : (draft.URGENCY === "URGENT" ? "ASAP" : null)} editing={editing} onChange={set("NEEDED_BY_DATE")} />
                </div>

                {skillChips(draft.REQUIRED_SKILLS).length > 0 && (
                  <div className={styles.chipSection}>
                    <div className={styles.chipSectionTitle}>Required Skills</div>
                    <div className={styles.chipRow}>
                      {skillChips(draft.REQUIRED_SKILLS).map((s) => (
                        <span key={s} className={styles.skillChipRequired}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {skillChips(draft.PREFERRED_SKILLS).length > 0 && (
                  <div className={styles.chipSection}>
                    <div className={styles.chipSectionTitle}>Preferred Skills</div>
                    <div className={styles.chipRow}>
                      {skillChips(draft.PREFERRED_SKILLS).map((s) => (
                        <span key={s} className={styles.skillChipPreferred}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                <CollapseSection
                  icon={<I.doc />}
                  title="Job Description"
                  open={expanded.desc}
                  onToggle={() => setExpanded((e) => ({ ...e, desc: !e.desc }))}
                >
                  {editing ? (
                    <textarea className={styles.sectionTextarea} rows={3} value={draft.JOB_DESCRIPTION || ""} onChange={(e) => set("JOB_DESCRIPTION")(e.target.value)} />
                  ) : (
                    <p className={styles.sectionText}>{draft.JOB_DESCRIPTION || "Not generated yet."}</p>
                  )}
                </CollapseSection>

                <CollapseSection
                  icon={<I.doc />}
                  title="Responsibilities"
                  open={expanded.resp}
                  onToggle={() => setExpanded((e) => ({ ...e, resp: !e.resp }))}
                >
                  {editing ? (
                    <textarea className={styles.sectionTextarea} rows={4} value={draft.RESPONSIBILITIES || ""} onChange={(e) => set("RESPONSIBILITIES")(e.target.value)} />
                  ) : bullets(draft.RESPONSIBILITIES).length > 0 ? (
                    <ul className={styles.sectionList}>
                      {bullets(draft.RESPONSIBILITIES).map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  ) : <p className={styles.sectionText}>Not generated yet.</p>}
                </CollapseSection>

                <CollapseSection
                  icon={<I.doc />}
                  title="Qualifications"
                  open={expanded.qual}
                  onToggle={() => setExpanded((e) => ({ ...e, qual: !e.qual }))}
                >
                  {editing ? (
                    <textarea className={styles.sectionTextarea} rows={3} value={draft.QUALIFICATIONS || ""} onChange={(e) => set("QUALIFICATIONS")(e.target.value)} />
                  ) : bullets(draft.QUALIFICATIONS).length > 0 ? (
                    <ul className={styles.sectionList}>
                      {bullets(draft.QUALIFICATIONS).map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  ) : <p className={styles.sectionText}>{draft.REQUIRED_EDUCATION || "Not generated yet."}</p>}
                </CollapseSection>

                {!committedReq ? (
                  <>
                    <button type="button" className={styles.confirmBtn} onClick={commit} disabled={committing}>
                      {committing ? "Creating…" : (<><I.check /> Confirm &amp; Create</>)}
                    </button>
                    <div className={styles.secondaryActions}>
                      <button type="button" className={styles.secondaryBtn} onClick={() => setEditing((v) => !v)}>
                        <I.edit /> {editing ? "Done editing" : "Edit"}
                      </button>
                      <button type="button" className={styles.secondaryBtn} onClick={() => { setMode("voice"); startListening(); }}>
                        <I.mic /> Modify with Voice
                      </button>
                      <button type="button" className={styles.secondaryBtn} onClick={() => setMode("chat")}>
                        <I.chat /> Modify with Chat
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.createdBanner}>
                    <I.check /> Requisition {committedReq.REQ_CODE} created — approval email sent.
                  </div>
                )}

                <div className={styles.shareRow}>
                  <button type="button" className={styles.shareBtn} onClick={generatePostImage} disabled={postBusy}>
                    {postBusy ? "Generating…" : (postImageUrl ? "Regenerate poster" : "Generate poster")}
                  </button>
                  {postImageUrl && (
                    <a className={styles.shareBtn} href={postImageUrl} download={`bvc24-hiring-${(draft.POSITION_TITLE || "role").toLowerCase().replace(/\s+/g, "-")}.png`}>
                      <I.download /> Download
                    </a>
                  )}
                  <button type="button" className={styles.shareBtn} onClick={copyPostText} disabled={postTextBusy}>
                    <I.copy /> {postTextBusy ? "Preparing…" : postTextCopied ? "Copied!" : "Copy job post text"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ───────────── Publish to job portals ───────────── */}
        <div className={styles.publishSection}>
          <div className={styles.publishHeader}>After creating the requisition, publish the job to job portals</div>
          <div className={styles.portalGrid}>
            {[
              { key: "career", label: "Company Career Page", connected: true },
              { key: "linkedin", label: "LinkedIn", connected: true },
              { key: "indeed", label: "Indeed", connected: false },
              { key: "naukri", label: "Naukri", connected: false },
              { key: "other", label: "Other Portals", connected: false },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                className={`${styles.portalCard} ${published.includes(p.key) ? styles.portalCardSelected : ""}`}
                onClick={() => togglePublish(p.key)}
                disabled={!canPublish || !p.connected}
                title={p.connected ? "" : "No API connection configured yet — use Copy job post text and post manually."}
              >
                {p.connected && <span className={styles.portalConnectedDot}><I.check /></span>}
                <span className={styles.portalLabel}>{p.label}</span>
                <span className={styles.portalStatus}>{p.connected ? "Connected" : "Not connected"}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.publishBtn}
            disabled={!canPublish || publishing || published.length === 0}
            onClick={() => {
              // No real portal API access exists (see backend
              // /recruitment/voice-agent/post-text's docstring) —
              // this never claims a real publish succeeded. Selecting
              // "Company Career Page" links it on the Jobs tab once
              // converted; everything else stays a manual-copy export.
              setPublishing(true);
              setTimeout(() => setPublishing(false), 400);
            }}
          >
            {publishing ? "Publishing…" : "Publish Job"}
          </button>
          {!canPublish && (
            <div className={styles.publishHint}>Create the requisition above first.</div>
          )}
        </div>

      </div>
    </div>
  );
}


function Fact({ icon, label, value, editing, onChange }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factIcon}>{icon}</span>
      <div>
        <div className={styles.factLabel}>{label}</div>
        {editing && onChange ? (
          <input className={styles.factInput} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <div className={styles.factValue}>{value ?? "—"}</div>
        )}
      </div>
    </div>
  );
}

function CollapseSection({ icon, title, open, onToggle, children }) {
  return (
    <div className={styles.collapse}>
      <button type="button" className={styles.collapseHeader} onClick={onToggle}>
        <span className={styles.collapseTitle}>{icon}{title}</span>
        {open ? <I.chevronDown /> : <I.chevronRight />}
      </button>
      {open && <div className={styles.collapseBody}>{children}</div>}
    </div>
  );
}
