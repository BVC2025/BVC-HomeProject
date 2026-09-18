import { useEffect, useMemo, useRef, useState } from "react";

/* Full-screen avatar experience for the Leave chatbot.

   Presentational component — no API calls. All state + handlers come
   in as props from LeaveAIAssistant so this file only cares about the
   visual layer.

   Design goals (per user brief 2026-09-18):
   • Character fills most of the viewport, feels like you're standing
     in front of a person, not a bot chip.
   • Idle state — subtle breathing (scale + Y-drift, 4s loop).
   • Blink overlay — thin dark bar animates across the eye zone every
     ~4s. Works on any static image; not perfect but reads as "alive".
   • Listening state — green aura + soft waveform bars below the
     character while the user speaks.
   • Thinking state — amber aura + three dots ellipsis.
   • Speaking state — red pulse ring + audio wave visualisation, and
     a small mouth-region shimmer to simulate lip movement.
   • Reply subtitle — floating bubble above the character, updates as
     the agent replies. Fades in / out.
   • Bottom bar — mic, text input (fallback since user's mic often
     blocked), send, mute toggle, language pills, close.

   Character image lives at /priya-full.png (public/). Falls back to
   the smaller /priyaa.jpg if the full-size one is missing.
*/

const AVATAR_FULL_SRC     = "/priya-full.png";      // recommend 800×1200
const AVATAR_FALLBACK_SRC = "/priyaa.jpg";

const LANGUAGES = [
  { key: "auto",      label: "Auto" },
  { key: "en",        label: "English" },
  { key: "ta",        label: "தமிழ்" },
  { key: "thanglish", label: "Thanglish" },
];


export default function LeaveAvatarStage({
  // state
  messages,
  input,
  listening,
  thinking,
  speaking,
  submitting,
  muted,
  pendingDraft,
  error,
  language,
  agentName = "Priya",
  micSupported = false,
  // handlers
  onClose,
  onChangeInput,
  onSendText,
  onStartListening,
  onStopListening,
  onLangChange,
  onToggleMute,
  onConfirmDraft,
  onCancelDraft,
}) {

  // Latest assistant reply — subtitle bubble content.
  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i].content;
    }
    return "";
  }, [messages]);

  // Current state → what the UI foregrounds.
  const stateKind = listening ? "listening"
                  : thinking  ? "thinking"
                  : speaking  ? "speaking"
                  : "idle";

  const [imgSrc, setImgSrc]   = useState(AVATAR_FULL_SRC);
  const [showBubble, setShow] = useState(false);
  useEffect(() => {
    // Fade the subtitle whenever a new reply arrives so the eye is drawn
    // to it, not a static bubble that just quietly changes.
    if (lastAssistant) {
      setShow(false);
      const t = setTimeout(() => setShow(true), 60);
      return () => clearTimeout(t);
    }
    setShow(false);
  }, [lastAssistant]);

  // Focus the text box when the stage opens so typing works instantly
  // (mic often blocked over HTTP).
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) onSendText(input);
  };

  return (
    <div style={S.stage} role="dialog" aria-modal="true">
      <StageStyles />

      {/* Backdrop gradient — deep red at bottom, dark navy at top,
          so the character (mostly dark clothing) reads clearly. */}
      <div style={S.backdrop} />

      {/* Close button — top-right */}
      <button type="button" style={S.closeBtn} onClick={onClose} aria-label="Close">✕</button>

      {/* Top row — name + language + mute */}
      <div style={S.topBar}>
        <div style={S.nameBadge}>
          <span style={S.liveDot(stateKind)} />
          <span style={S.name}>{agentName}</span>
          <span style={S.state}>· {stateKind === "idle" ? "ready" : stateKind}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={S.langBar}>
            {LANGUAGES.map((l) => (
              <button
                key={l.key}
                type="button"
                style={S.langPill(language === l.key)}
                onClick={() => onLangChange(l.key)}
                title={
                  l.key === "auto" ? "Reply in whatever language you type in"
                  : l.key === "ta" ? "Force reply in Tamil script"
                  : l.key === "thanglish" ? "Force reply in Thanglish (Tamil in Latin script)"
                  : "Force reply in English"
                }
              >
                {l.label}
              </button>
            ))}
            <button
              type="button"
              style={S.iconBtn}
              onClick={onToggleMute}
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
          {language === "auto" && (
            <div style={S.langHint}>
              For Tamil replies, tap <strong style={{ color: "#fff" }}>தமிழ்</strong>
            </div>
          )}
        </div>
      </div>

      {/* Character container */}
      <div style={S.charWrap}>
        {/* State-coloured aura ring behind the character */}
        <div style={{ ...S.aura, ...S.auraByState[stateKind] }} />

        {/* Breathing wrapper — subtle scale animation on idle,
            heavier bounce when speaking. */}
        <div className={`priya-breathe ${stateKind}`}>
          <img
            src={imgSrc}
            onError={() => imgSrc === AVATAR_FULL_SRC && setImgSrc(AVATAR_FALLBACK_SRC)}
            alt={agentName}
            style={S.charImg}
          />

          {/* Eye-blink overlay — thin horizontal bar animated across
              the eye zone. Not perfect on a 3D render but reads as
              alive-ish. */}
          <div className="priya-blink" style={S.blinkOverlay} />

          {/* Mouth-region shimmer while speaking. */}
          {stateKind === "speaking" && (
            <div className="priya-mouth-shimmer" style={S.mouthShimmer} />
          )}
        </div>

        {/* Speaking waveform — 24 bars, animate on TTS play */}
        {stateKind === "speaking" && (
          <div style={S.waveWrap} aria-hidden="true">
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                className="priya-wave-bar"
                style={{ animationDelay: `${(i % 8) * 0.08}s` }}
              />
            ))}
          </div>
        )}

        {/* Thinking dots */}
        {stateKind === "thinking" && (
          <div style={S.thinkDots} aria-hidden="true">
            <span /><span /><span />
          </div>
        )}

        {/* Listening indicator */}
        {stateKind === "listening" && (
          <div style={S.listeningBadge}>
            <span style={S.recDot} /> Listening…
          </div>
        )}
      </div>

      {/* Subtitle bubble — latest reply floats above the character */}
      {lastAssistant && (
        <div style={{ ...S.bubble, opacity: showBubble ? 1 : 0 }}>
          {lastAssistant}
        </div>
      )}

      {/* Pending-draft confirm bar */}
      {pendingDraft && (
        <div style={S.draftBar}>
          <div style={S.draftLine}>
            <strong>Confirm before sending:</strong>&nbsp;
            {pendingDraft.leave_type} · {pendingDraft.start_date} → {pendingDraft.end_date}
            {pendingDraft.days ? ` · ${pendingDraft.days} day(s)` : ""}
            {pendingDraft.half_day ? " (half day)" : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.cancelBtn} onClick={onCancelDraft} disabled={submitting}>Cancel</button>
            <button style={S.confirmBtn} onClick={onConfirmDraft} disabled={submitting}>
              {submitting ? "Sending…" : "Confirm & Send"}
            </button>
          </div>
        </div>
      )}

      {error && <div style={S.errorBar}>{error}</div>}

      {/* Bottom control bar — mic + text input + send */}
      <form style={S.bottomBar} onSubmit={handleTextSubmit}>
        <button
          type="button"
          style={S.micBtn(listening)}
          onClick={listening ? onStopListening : onStartListening}
          disabled={!micSupported && !listening}
          title={
            !micSupported
              ? "Mic unavailable in this browser — use HTTPS to enable. Type instead."
              : listening ? "Stop listening" : "Start listening"
          }
          aria-label="Toggle voice input"
        >
          {listening ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="21" />
              <line x1="9" y1="21" x2="15" y2="21" />
            </svg>
          )}
        </button>

        <input
          ref={inputRef}
          style={S.input}
          value={input}
          onChange={(e) => onChangeInput(e.target.value)}
          placeholder={
            listening
              ? "Listening… speak now"
              : `Type or press mic — say something like "naaku naalaikku one day casual leave venum"`
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
    </div>
  );
}


// ─── Global keyframes + hover styles ─────────────────────────────────

function StageStyles() {
  return (
    <style>{`
      @keyframes priyaFadeIn {
        from { opacity: 0; transform: scale(0.98); }
        to   { opacity: 1; transform: scale(1); }
      }
      @keyframes priyaBreathe {
        0%   { transform: translateY(0)     scale(1); }
        50%  { transform: translateY(-4px)  scale(1.005); }
        100% { transform: translateY(0)     scale(1); }
      }
      @keyframes priyaBounceSpeak {
        0%   { transform: translateY(0)    rotate(0deg);   filter: brightness(1); }
        20%  { transform: translateY(-4px) rotate(-1.5deg); filter: brightness(1.05); }
        40%  { transform: translateY(-8px) rotate(0deg);    filter: brightness(1.08); }
        60%  { transform: translateY(-6px) rotate(1.2deg);  filter: brightness(1.05); }
        80%  { transform: translateY(-2px) rotate(0deg);    filter: brightness(1.02); }
        100% { transform: translateY(0)    rotate(0deg);    filter: brightness(1); }
      }
      @keyframes priyaListenLean {
        0%, 100% { transform: translateY(0)    rotate(0deg); }
        50%      { transform: translateY(-2px) rotate(-0.8deg); }
      }
      @keyframes priyaAuraPulse {
        0%   { opacity: 0.55; transform: translate(-50%, -50%) scale(0.98); }
        50%  { opacity: 0.85; transform: translate(-50%, -50%) scale(1.05); }
        100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.98); }
      }
      @keyframes priyaWave {
        0%, 100% { transform: scaleY(0.35); }
        50%      { transform: scaleY(1); }
      }
      @keyframes priyaBlink {
        0%, 92%, 100% { transform: translateY(-3px) scaleY(0); opacity: 0; }
        94%           { transform: translateY(0)   scaleY(1); opacity: 0.85; }
        96%           { transform: translateY(0)   scaleY(1); opacity: 0.85; }
        98%           { transform: translateY(3px) scaleY(0); opacity: 0; }
      }
      @keyframes priyaThinkDot {
        0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
        40%           { opacity: 1;   transform: translateY(-4px); }
      }
      @keyframes priyaMouthShimmer {
        0%, 100% { opacity: 0.15; transform: scaleX(0.85); }
        50%      { opacity: 0.35; transform: scaleX(1.15); }
      }

      .priya-breathe { animation: priyaBreathe 4s ease-in-out infinite; position: relative; }
      .priya-breathe.listening { animation: priyaListenLean 2.2s ease-in-out infinite; }
      .priya-breathe.thinking  { animation: priyaBreathe 2s ease-in-out infinite; }
      .priya-breathe.speaking  { animation: priyaBounceSpeak 0.6s ease-in-out infinite; transform-origin: bottom center; }
      .priya-blink   { animation: priyaBlink 4.2s ease-in-out infinite; }
      .priya-wave-bar {
        display: inline-block; width: 4px; height: 32px;
        background: linear-gradient(180deg, #dc2626, #7a1022);
        margin: 0 2px; border-radius: 2px; transform-origin: center bottom;
        animation: priyaWave 0.9s ease-in-out infinite;
      }
      .priya-mouth-shimmer { animation: priyaMouthShimmer 0.5s ease-in-out infinite; }
    `}</style>
  );
}


// ─── styles ───────────────────────────────────────────────────────────

const S = {
  stage: {
    position: "fixed", inset: 0, zIndex: 10000,
    display: "flex", flexDirection: "column",
    animation: "priyaFadeIn 0.25s ease-out",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  backdrop: {
    position: "absolute", inset: 0,
    background:
      "radial-gradient(1200px 800px at 50% 100%, #7a1022 0%, #1a0508 55%, #05060a 100%)",
    zIndex: 0,
  },
  closeBtn: {
    position: "absolute", top: 16, right: 20, zIndex: 5,
    width: 40, height: 40, borderRadius: "50%",
    background: "rgba(0,0,0,0.35)", color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    fontSize: 18, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  topBar: {
    position: "relative", zIndex: 4,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 20px 8px 20px", flexWrap: "wrap", gap: 10,
  },
  nameBadge: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 14px", borderRadius: 999,
    background: "rgba(255,255,255,0.1)", color: "#fff",
    backdropFilter: "blur(6px)",
  },
  liveDot: (kind) => ({
    width: 8, height: 8, borderRadius: "50%",
    background:
      kind === "listening" ? "#22c55e" :
      kind === "thinking"  ? "#f59e0b" :
      kind === "speaking"  ? "#ef4444" : "#94a3b8",
    boxShadow: `0 0 0 4px rgba(255,255,255,0.05)`,
  }),
  name: { fontWeight: 800, letterSpacing: 0.3 },
  state: { fontSize: 12, opacity: 0.7 },
  langBar: { display: "flex", gap: 6, alignItems: "center" },
  langHint: {
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    padding: "3px 10px 0",
    letterSpacing: 0.2,
  },
  langPill: (active) => ({
    padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
    background: active ? "#fff" : "rgba(255,255,255,0.12)",
    color: active ? "#7a1022" : "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    cursor: "pointer",
  }),
  iconBtn: {
    width: 34, height: 34, borderRadius: "50%",
    background: "rgba(255,255,255,0.12)", color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    cursor: "pointer", fontSize: 15,
  },

  charWrap: {
    position: "relative", zIndex: 2, flex: 1,
    display: "flex", alignItems: "flex-end", justifyContent: "center",
    padding: "20px 16px 0",
    minHeight: 0,
  },
  aura: {
    position: "absolute", left: "50%", bottom: "18%",
    width: 480, height: 480, borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    filter: "blur(40px)", zIndex: 0,
    animation: "priyaAuraPulse 3.2s ease-in-out infinite",
    pointerEvents: "none",
  },
  auraByState: {
    idle:      { background: "rgba(220, 38, 38, 0.35)" },
    listening: { background: "rgba(34, 197, 94, 0.55)" },
    thinking:  { background: "rgba(245, 158, 11, 0.5)" },
    speaking:  { background: "rgba(239, 68, 68, 0.65)" },
  },
  charImg: {
    height: "min(72vh, 720px)",
    maxWidth: "88vw",
    objectFit: "contain", objectPosition: "bottom center",
    display: "block", position: "relative", zIndex: 2,
    filter: "drop-shadow(0 40px 60px rgba(0,0,0,0.55))",
    // Hides the white background of a non-transparent PNG/JPG against
    // the dark red backdrop — every white pixel picks up the backdrop
    // colour, character pixels stay themselves. Not a perfect matte
    // but reads as no-background against the deep red gradient.
    mixBlendMode: "multiply",
  },

  // Blink bar — approximate horizontal band across upper-face area
  blinkOverlay: {
    position: "absolute",
    top: "22%",
    left: "26%", right: "26%",
    height: 8,
    background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.6), transparent)",
    borderRadius: 4,
    transformOrigin: "center",
    pointerEvents: "none",
    zIndex: 3,
    mixBlendMode: "multiply",
  },
  mouthShimmer: {
    position: "absolute",
    top: "58%", left: "42%", right: "42%",
    height: 6, borderRadius: 6,
    background: "radial-gradient(closest-side, rgba(255,255,255,0.7), transparent)",
    zIndex: 3, pointerEvents: "none", transformOrigin: "center",
  },

  waveWrap: {
    position: "absolute", bottom: 24, left: "50%",
    transform: "translateX(-50%)", zIndex: 3,
    display: "flex", alignItems: "flex-end",
  },
  thinkDots: {
    position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)",
    display: "flex", gap: 8, zIndex: 3,
  },
  listeningBadge: {
    position: "absolute", bottom: 40, left: "50%",
    transform: "translateX(-50%)", zIndex: 3,
    padding: "6px 14px", borderRadius: 999,
    background: "rgba(34, 197, 94, 0.9)", color: "#fff",
    fontWeight: 800, fontSize: 12, letterSpacing: 0.4,
    display: "flex", alignItems: "center", gap: 8,
    boxShadow: "0 0 0 6px rgba(34,197,94,0.15)",
  },
  recDot: {
    width: 10, height: 10, borderRadius: "50%", background: "#fff",
    boxShadow: "0 0 8px rgba(255,255,255,0.9)",
  },

  bubble: {
    position: "relative", zIndex: 3,
    margin: "0 auto 16px",
    maxWidth: "min(680px, 92vw)",
    padding: "14px 22px", borderRadius: 20,
    background: "rgba(255,255,255,0.95)", color: "#0f172a",
    fontSize: 16, lineHeight: 1.5, fontWeight: 500,
    boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
    transition: "opacity 0.35s ease",
    textAlign: "center", whiteSpace: "pre-wrap",
  },

  draftBar: {
    position: "relative", zIndex: 3,
    margin: "0 auto 12px", maxWidth: "min(680px, 92vw)",
    padding: "10px 14px", borderRadius: 14,
    background: "#fef2f2", border: "1px solid #fecaca", color: "#7a1022",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, flexWrap: "wrap",
  },
  draftLine: { fontSize: 13, fontWeight: 600 },
  confirmBtn: {
    padding: "6px 14px", background: "#16a34a", color: "#fff",
    border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer",
  },
  cancelBtn: {
    padding: "6px 14px", background: "#fff", color: "#7a1022",
    border: "1px solid #fca5a5", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer",
  },

  errorBar: {
    position: "relative", zIndex: 3,
    margin: "0 auto 10px", maxWidth: "min(680px, 92vw)",
    padding: "8px 14px", borderRadius: 10,
    background: "rgba(254,242,242,0.95)", color: "#b91c1c",
    border: "1px solid rgba(252,165,165,0.7)",
    fontSize: 13,
  },

  bottomBar: {
    position: "relative", zIndex: 4,
    display: "flex", alignItems: "center", gap: 10,
    padding: "14px 18px 22px",
    background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.35) 50%)",
  },
  micBtn: (active) => ({
    width: 52, height: 52, borderRadius: "50%",
    border: "none", background: active ? "#dc2626" : "#7a1022", color: "#fff",
    cursor: "pointer",
    boxShadow: active
      ? "0 0 0 8px rgba(220,38,38,0.35), 0 4px 12px rgba(0,0,0,0.35)"
      : "0 4px 12px rgba(0,0,0,0.35)",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  }),
  input: {
    flex: 1, padding: "13px 18px", borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.96)", color: "#0f172a",
    fontSize: 15, outline: "none", minWidth: 0,
  },
  sendBtn: {
    padding: "12px 20px", borderRadius: 999,
    border: "none", background: "#dc2626", color: "#fff",
    fontWeight: 800, fontSize: 14, cursor: "pointer", flexShrink: 0,
  },
};
