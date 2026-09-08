// =====================================================================
// RecruitmentAgentWorkspace — inline, page-top AI recruitment agent.
//
// Replaces the popup VoiceRequisitionModal as the primary entry point
// to the Recruitment module. Deepthi's avatar + voice + chat panel
// live on the left; a live-count card strip lives on the right so HR
// sees pending requisitions, open jobs, today's interviews and
// pending offers at a glance while conversing with the agent.
//
// The existing tab bar (Requisitions / Jobs / … / Offers) stays
// intact below this workspace as the power-user surface.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import API from "../services/api";

const BVC_RED = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";

const CONFIRM_TRIGGERS = [
  "confirm", "yes create", "yes, create", "create it", "go ahead",
  "please create", "submit", "raise it",
  "sari", "seri", "aama", "aamam", "aan", "aanaa",
  "seri create", "seri panunga", "post pannunga", "post panu",
  "create panu", "create panunga",
];

const CANCEL_TRIGGERS = [
  "cancel", "no cancel", "stop",
  "veenam", "vendaam", "vendam", "illa",
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


export default function RecruitmentAgentWorkspace({
  onCommitted,
  onOpenManual,
  onJumpTab,
}) {

  // -----------------------------------------------------------------
  // State
  // -----------------------------------------------------------------
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [postBusy, setPostBusy] = useState(false);
  const [history, setHistory] = useState([]);   // [{role, content}]
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState(null);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [srLang, setSrLang] = useState("en-IN");
  const [voice, setVoice] = useState("pooja");
  const [speaking, setSpeaking] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(true);
  const [postImageUrl, setPostImageUrl] = useState(null);

  // Live counts for the right-side card strip
  const [counts, setCounts] = useState({
    reqPending: null, jobsOpen: null,
    interviewsToday: null, offersPending: null,
  });

  const recogRef = useRef(null);
  const noSpeechRetryRef = useRef(0);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const historyRef = useRef([]);
  historyRef.current = history;

  // -----------------------------------------------------------------
  // Fetch live counts once + refresh after every commit
  // -----------------------------------------------------------------
  const refreshCounts = () => {
    Promise.allSettled([
      API.get("/recruitment/requisitions?status=PENDING"),
      API.get("/recruitment/jobs"),
      API.get("/recruitment/interviews"),
      API.get("/recruitment/offers"),
    ]).then(([r, j, i, o]) => {
      const today = new Date().toISOString().slice(0, 10);
      setCounts({
        reqPending: r.status === "fulfilled" ? (r.value.data || []).length : 0,
        jobsOpen: j.status === "fulfilled"
          ? (j.value.data || []).filter((x) => (x.STATUS || "").toUpperCase() === "OPEN").length
          : 0,
        interviewsToday: i.status === "fulfilled"
          ? (i.value.data || []).filter((x) => (x.SCHEDULED_AT || "").slice(0, 10) === today).length
          : 0,
        offersPending: o.status === "fulfilled"
          ? (o.value.data || []).filter((x) => ["DRAFT", "SENT"].includes((x.STATUS || "").toUpperCase())).length
          : 0,
      });
    });
  };
  useEffect(() => { refreshCounts(); }, []);

  // -----------------------------------------------------------------
  // Voice output helpers (server-side Sarvam TTS)
  // -----------------------------------------------------------------
  const stopServerAudio = () => {
    try {
      const a = audioRef.current;
      if (a) { a.pause(); a.currentTime = 0; }
    } catch { }
    try { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); } catch { }
    audioUrlRef.current = null;
    audioRef.current = null;
    setSpeaking(false);
  };

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
      const blob = res.data instanceof Blob
        ? res.data : new Blob([res.data], { type: "audio/wav" });
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
      await el.play().catch(() => {
        setSpeaking(false);
        if (loud) throw new Error("Browser blocked audio — click Deepthi again.");
      });
    } catch (e) {
      if (loud) {
        let detail = e?.message || "Voice failed";
        try {
          if (e?.response?.data instanceof Blob) detail = await e.response.data.text();
          else if (e?.response?.data?.detail) detail = e.response.data.detail;
        } catch { }
        setError(`Voice failed · ${String(detail).slice(0, 300)}`);
      }
    }
  };

  useEffect(() => {
    const rec = getRecognition();
    if (!rec) setSupported(false);
    return () => {
      stopServerAudio();
      try { recogRef.current?.stop(); } catch { }
      if (postImageUrl) { try { URL.revokeObjectURL(postImageUrl); } catch { } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------
  // Agent turn — send utterance to interpret endpoint
  // -----------------------------------------------------------------
  const sendToAgent = async (utterance) => {
    if (!utterance.trim()) return;
    setError("");

    // Confirm / cancel shortcut when a draft is on screen
    if (draft) {
      const lower = utterance.toLowerCase();
      if (CONFIRM_TRIGGERS.some((w) => lower.includes(w))) { commit(); return; }
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
        utterance, history: historyRef.current,
      });
      const { reply, action, draft: newDraft, provider: prov } = res.data || {};
      setProvider(prov || "");
      setHistory((h) => [...h, { role: "assistant", content: reply || "" }]);
      if (action === "PROPOSE_DRAFT" && newDraft) setDraft(newDraft);
      if (reply) speakServer(reply, detectLang(reply));
    } catch (e) {
      setError(e?.response?.data?.detail || "Agent failed to reply.");
    } finally { setThinking(false); }
  };

  // -----------------------------------------------------------------
  // Mic listening — same reliable path as the modal version
  // -----------------------------------------------------------------
  const startListening = (opts = {}) => {
    const { isRetry = false } = opts;
    if (!supported) return;
    if (!isRetry) {
      setInterim(""); setError("");
      noSpeechRetryRef.current = 0;
    }
    stopServerAudio();

    const rec = getRecognition();
    if (!rec) return;
    rec.lang = srLang;
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
        try { rec.stop(); } catch { }
        setTimeout(() => startListening({ isRetry: true }), 200);
        return;
      }
      if (code === "no-speech")
        setError("I didn't hear anything. Tap the mic and start speaking within 3 seconds — or type below.");
      else if (code === "not-allowed" || code === "service-not-allowed")
        setError("Mic permission blocked. Click the padlock → Site settings → Microphone → Allow, then reload.");
      else if (code === "audio-capture")
        setError("No microphone detected. Use the text box below.");
      else
        setError(`Mic error: ${code}. Type below to continue.`);
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
    catch { setError("Could not start mic — is another tab using it?"); setListening(false); }
  };

  const stopListening = () => {
    try { recogRef.current?.stop(); } catch { }
    setListening(false);
  };

  // -----------------------------------------------------------------
  // Commit the draft → real requisition
  // -----------------------------------------------------------------
  const commit = async () => {
    if (!draft?.POSITION_TITLE) return;
    setCommitting(true); setError("");
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
        `Requisition ${res.data?.REQ_CODE || ""} created. Approval email sent.`,
        "en-IN",
      );
      onCommitted?.(res.data);
      // Reset draft + refresh counts
      setDraft(null);
      setPostImageUrl(null);
      refreshCounts();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Could not create the requisition.";
      setError(msg);
      speakServer(msg, "en-IN");
    } finally { setCommitting(false); }
  };

  // -----------------------------------------------------------------
  // Job-post image generator
  // -----------------------------------------------------------------
  const generatePostImage = async () => {
    if (!draft?.POSITION_TITLE) return;
    setPostBusy(true); setError("");
    try {
      if (postImageUrl) { try { URL.revokeObjectURL(postImageUrl); } catch { } }
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
      let msg = e?.response?.data?.detail || e?.message || "Poster failed.";
      if (e?.response?.data instanceof Blob) {
        try { msg = await e.response.data.text(); } catch { }
      }
      setError(`Post generation failed · ${String(msg).slice(0, 300)}`);
    } finally { setPostBusy(false); }
  };

  const downloadPostImage = () => {
    if (!postImageUrl || !draft) return;
    const a = document.createElement("a");
    a.href = postImageUrl;
    const slug = (draft.POSITION_TITLE || "role")
      .trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    a.download = `bvc24-hiring-${slug}.png`;
    document.body.appendChild(a);
    a.click(); a.remove();
  };

  // -----------------------------------------------------------------
  // Render — 2-column layout, agent left, counts right
  // -----------------------------------------------------------------
  return (
    <div style={{
      background: "linear-gradient(135deg, #fff 0%, #fdf7f4 100%)",
      border: "1px solid #e6dfd6",
      borderRadius: 14,
      padding: 20,
      marginBottom: 18,
      boxShadow: "0 6px 20px rgba(15,23,42,0.05)",
    }}>

      {/* Pulse keyframes */}
      <style>{`
        @keyframes deepthi-pulse-inline {
          0%   { box-shadow: 0 0 0 0   rgba(200, 16, 46, 0.55); }
          60%  { box-shadow: 0 0 0 14px rgba(200, 16, 46, 0);   }
          100% { box-shadow: 0 0 0 0   rgba(200, 16, 46, 0);   }
        }
        @media (prefers-reduced-motion: reduce) {
          .deepthi-inline-pulse { animation: none !important; }
        }
      `}</style>

      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(320px, 1.5fr) 1fr",
        gap: 20,
      }}>

        {/* ─────────────── LEFT · agent panel ─────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

          {/* Header row — avatar + welcome + provider tag */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              type="button"
              onClick={() => speakServer(
                "Hi, I am Deepthi, your BVC24 recruitment assistant. Tell me what role you want to hire for.",
                "en-IN", { loud: true },
              )}
              title="Tap Deepthi to hear her introduce herself"
              className={speaking ? "deepthi-inline-pulse" : ""}
              style={{
                width: 68, height: 68, borderRadius: "50%",
                border: `3px solid ${BVC_RED}`,
                background: avatarLoaded
                  ? `url('/deepthi.jpg') center/cover no-repeat`
                  : `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`,
                padding: 0, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden", flexShrink: 0,
                animation: speaking ? "deepthi-pulse-inline 1.4s ease-out infinite" : "none",
                boxShadow: "0 4px 14px rgba(200, 16, 46, 0.20)",
              }}
            >
              <img src="/deepthi.jpg" alt="" onError={() => setAvatarLoaded(false)}
                style={{ display: "none" }} />
              {!avatarLoaded && (
                <span style={{
                  color: "white", fontSize: 28, fontWeight: 800,
                  fontFamily: "Georgia, serif",
                }}>D</span>
              )}
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4,
                color: BVC_RED, textTransform: "uppercase",
              }}>
                Deepthi · Recruitment agent
                {provider && (
                  <span style={{
                    marginLeft: 8, color: "#94a3b8", fontWeight: 500,
                    fontFamily: "ui-monospace, monospace", letterSpacing: 0.4,
                  }}>· {provider}</span>
                )}
              </div>
              <div style={{
                fontSize: 18, fontWeight: 700, color: "#0f172a",
                lineHeight: 1.2, marginTop: 2,
              }}>
                {listening ? "Listening… speak now"
                  : thinking ? "Thinking…"
                    : committing ? "Creating…"
                      : draft ? "Draft ready — say confirm or press Create"
                        : speaking ? "Speaking…"
                          : "Speak or type your hiring request"}
              </div>
              <div style={{ fontSize: 12, color: "#6d6259", marginTop: 3 }}>
                Tamil · English · Thanglish · Hindi — Deepthi adapts.
              </div>
            </div>
          </div>

          {/* Input row — mic + language + voice + type box */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={!supported || thinking || committing}
              title={listening ? "Stop" : "Tap to speak"}
              style={{
                width: 44, height: 44, borderRadius: "50%",
                border: "none",
                background: listening
                  ? `radial-gradient(circle at 30% 30%, #ef4444, #7a1022)`
                  : `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`,
                color: "white",
                cursor: supported ? "pointer" : "not-allowed",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                boxShadow: listening
                  ? "0 0 0 5px rgba(239, 68, 68, 0.20)"
                  : "0 4px 12px rgba(200, 16, 46, 0.25)",
                opacity: (thinking || committing) ? 0.6 : 1,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>

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
              placeholder="…or type your request here"
              style={{
                flex: "1 1 220px", padding: "10px 14px",
                border: "1px solid #cbd5e1", borderRadius: 8,
                fontSize: 13.5, background: "white", color: "#0f172a",
                minWidth: 0,
              }}
            />

            <select
              value={srLang}
              onChange={(e) => setSrLang(e.target.value)}
              disabled={listening}
              title="Mic language"
              style={{
                padding: "8px 10px", fontSize: 12,
                border: "1px solid #cbd5e1", borderRadius: 8,
                background: "white", color: "#0f172a", cursor: "pointer",
              }}
            >
              <option value="en-IN">🎤 English / Thanglish</option>
              <option value="ta-IN">🎤 Tamil</option>
              <option value="hi-IN">🎤 Hindi</option>
              <option value="en-US">🎤 English (US)</option>
            </select>

            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              title="Deepthi's voice"
              style={{
                padding: "8px 10px", fontSize: 12,
                border: "1px solid #cbd5e1", borderRadius: 8,
                background: "white", color: "#0f172a", cursor: "pointer",
              }}
            >
              <optgroup label="Neutral">
                <option value="priya">🔊 Priya</option>
                <option value="pooja">🔊 Pooja</option>
                <option value="shruti">🔊 Shruti</option>
              </optgroup>
              <optgroup label="Warm">
                <option value="kavya">🔊 Kavya</option>
                <option value="ishita">🔊 Ishita</option>
                <option value="neha">🔊 Neha</option>
              </optgroup>
              <optgroup label="Formal">
                <option value="shreya">🔊 Shreya</option>
                <option value="kavitha">🔊 Kavitha</option>
                <option value="suhani">🔊 Suhani</option>
              </optgroup>
            </select>
          </div>

          {/* Interim transcript */}
          {interim && (
            <div style={{
              fontSize: 12.5, color: "#64748b", fontStyle: "italic",
              padding: "6px 12px", background: "#f8fafc",
              borderRadius: 6,
            }}>
              "{interim}"
            </div>
          )}

          {/* Conversation tail — last 4 turns */}
          {history.length > 0 && (
            <div style={{
              maxHeight: 130, overflowY: "auto",
              padding: "8px 12px", background: "#f8fafc",
              border: "1px solid #e2e8f0", borderRadius: 8,
              display: "flex", flexDirection: "column", gap: 5,
            }}>
              {history.slice(-4).map((t, i) => (
                <div key={i} style={{
                  fontSize: 12.5, lineHeight: 1.45,
                  color: t.role === "user" ? "#0f172a" : BVC_DARK,
                }}>
                  <span style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 10, letterSpacing: 0.4,
                    textTransform: "uppercase",
                    color: t.role === "user" ? "#64748b" : BVC_RED,
                    marginRight: 6,
                  }}>{t.role === "user" ? "You" : "Deepthi"}</span>
                  {t.content}
                </div>
              ))}
            </div>
          )}

          {/* Draft preview + actions */}
          {draft && (
            <div style={{
              padding: 12,
              background: "#fef2f2",
              border: `1px solid ${BVC_GOLD}`,
              borderLeft: `4px solid ${BVC_RED}`,
              borderRadius: 8,
            }}>
              <div style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4,
                color: BVC_RED, textTransform: "uppercase", marginBottom: 8,
              }}>
                Draft requisition
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: "#0f172a" }}>
                <strong>{draft.POSITION_TITLE}</strong>
                {draft.DEPARTMENT && <> · {draft.DEPARTMENT}</>}
                {" · "}
                <b>{draft.HEADCOUNT || 1}</b> opening{(draft.HEADCOUNT || 1) > 1 ? "s" : ""}
                {(draft.EXPERIENCE_MIN_YEARS != null || draft.EXPERIENCE_MAX_YEARS != null) && (
                  <> · {draft.EXPERIENCE_MIN_YEARS ?? 0}{draft.EXPERIENCE_MAX_YEARS ? `–${draft.EXPERIENCE_MAX_YEARS}` : "+"} yrs</>
                )}
                {draft.REQUIRED_SKILLS && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                    Skills: {draft.REQUIRED_SKILLS}
                  </div>
                )}
                {(draft.BUDGET_CTC_MIN || draft.BUDGET_CTC_MAX) && (
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    CTC: ₹{Number(draft.BUDGET_CTC_MIN || 0).toLocaleString("en-IN")} – ₹{Number(draft.BUDGET_CTC_MAX || 0).toLocaleString("en-IN")}
                  </div>
                )}
              </div>

              <div style={{
                display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap",
              }}>
                <button onClick={commit} disabled={committing} style={{
                  padding: "7px 14px", background: BVC_RED, color: "white",
                  border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: committing ? "not-allowed" : "pointer",
                }}>
                  {committing ? "Creating…" : "✓ Confirm & create"}
                </button>
                <button onClick={generatePostImage} disabled={postBusy} style={{
                  padding: "7px 14px", background: "white", color: BVC_RED,
                  border: `1.5px solid ${BVC_RED}`, borderRadius: 8,
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>
                  {postBusy ? "Generating…" : (postImageUrl ? "Regenerate poster" : "Generate poster")}
                </button>
                {postImageUrl && (
                  <button onClick={downloadPostImage} style={{
                    padding: "7px 14px", background: "#f8fafc",
                    color: "#0f172a", border: "1px solid #cbd5e1",
                    borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                    ↓ Download poster
                  </button>
                )}
                <button onClick={() => setDraft(null)} style={{
                  padding: "7px 14px", background: "transparent",
                  color: "#64748b", border: "none", fontSize: 12,
                  cursor: "pointer",
                }}>Discard</button>
              </div>

              {postImageUrl && (
                <div style={{
                  marginTop: 10, padding: 6,
                  background: "#fbfaf6", border: "1px solid #e6dfd6",
                  borderRadius: 6, display: "flex", justifyContent: "center",
                }}>
                  <img src={postImageUrl} alt="Job post preview"
                    style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 4 }} />
                </div>
              )}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div style={{
              padding: "8px 12px", background: "#fef2f2",
              border: "1px solid #fecaca", borderRadius: 8,
              color: "#b91c1c", fontSize: 12,
            }}>
              {error}
            </div>
          )}

          {/* Secondary: manual fallback */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            paddingTop: 10, borderTop: "1px dashed #e6dfd6",
            fontSize: 12, color: "#94a3b8",
          }}>
            Prefer forms?
            <button onClick={onOpenManual} style={{
              padding: "5px 12px", background: "transparent",
              color: BVC_DARK, border: `1px solid ${BVC_DARK}`,
              borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}>
              Create manually
            </button>
          </div>
        </div>

        {/* ─────────────── RIGHT · live count strip ─────────────── */}
        <div style={{
          display: "flex", flexDirection: "column", gap: 10,
          minWidth: 0,
        }}>
          <CountCard
            label="Requisitions pending" value={counts.reqPending}
            hint="Awaiting MD approval"
            tone={BVC_RED}
            onClick={() => onJumpTab?.("requisitions")}
          />
          <CountCard
            label="Open jobs" value={counts.jobsOpen}
            hint="Live positions"
            tone="#2563eb"
            onClick={() => onJumpTab?.("jobs")}
          />
          <CountCard
            label="Interviews today" value={counts.interviewsToday}
            hint="Scheduled for today"
            tone="#047857"
            onClick={() => onJumpTab?.("interviews")}
          />
          <CountCard
            label="Offers pending" value={counts.offersPending}
            hint="Draft or awaiting response"
            tone={BVC_GOLD}
            onClick={() => onJumpTab?.("offers")}
          />
        </div>

      </div>
    </div>
  );
}


function CountCard({ label, value, hint, tone, onClick }) {
  const v = value == null ? "…" : value;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderLeft: `4px solid ${tone}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        textAlign: "left",
        display: "flex", flexDirection: "column",
        gap: 2, flex: 1, minWidth: 0,
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
        color: "#64748b", textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 30, fontWeight: 800, color: tone,
        lineHeight: 1.1, letterSpacing: -0.5,
      }}>
        {v}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>{hint}</div>
    </button>
  );
}
