import { useEffect, useMemo, useRef, useState } from "react";
import LeaveAssistantAvatar from "./avatar/LeaveAssistantAvatar";
import { avatarSession } from "../services/avatarSessionService";

/* Full-screen avatar experience for the Leave chatbot.

   Two rendering paths, chosen at runtime:

   1. REAL-TIME AVATAR (preferred) — <LeaveAssistantAvatar> streams a
      talking-head video from D-ID and lip-syncs to the Sarvam TTS
      audio blob. Activated when the backend /avatar-session/health
      probe confirms DID_API_KEY is set.

   2. STATIC FALLBACK — the original transparent PNG of Priya with
      amplitude-driven CSS motion. Used when D-ID is unreachable, the
      backend key is missing, or the WebRTC handshake fails. Ensures
      the Leave chatbot still works with no dependency on D-ID.

   Everything below is unchanged from before — top bar, subtitle
   bubble, draft confirmation, language pills, bottom input row. Only
   the character-render block in the middle is swapped based on the
   avatar-ready flag.
*/

// Static-fallback image assets.
const AVATAR_FULL_SRC     = "/Assistant.png";
const AVATAR_FALLBACK_SRC = "/priya-full.png";

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
  speakAmp = 0,     // 0..1 real-time RMS of Sarvam TTS audio (fallback anim)
  ttsBlob = null,   // MP3 Blob of the current reply — fed to D-ID for lip-sync
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

  // Avatar mode selection — probe backend once on mount. If D-ID is
  // configured we render the real-time avatar; otherwise (missing
  // key, unreachable, or user on offline LAN) we render the static
  // Priya image with amplitude-driven CSS motion. `avatarFailed`
  // flips to true if the WebRTC session errors mid-conversation so
  // the UI degrades gracefully without a full page reload.
  const [avatarReady,  setAvatarReady]  = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    avatarSession.health()
      .then((h) => { if (!cancelled) setAvatarReady(!!h?.enabled); })
      .catch(()  => { if (!cancelled) setAvatarReady(false); });
    return () => { cancelled = true; };
  }, []);
  const useLiveAvatar = avatarReady && !avatarFailed;

  // Map internal state → avatar contract states.
  const avatarState = listening ? "listening"
                    : thinking  ? "thinking"
                    : speaking  ? "speaking"
                    : "idle";

  // Mouth position calibration — persists in localStorage so once
  // the admin nudges the mouth onto the character's actual lips it
  // stays there across sessions. Shift+Arrows while the stage is
  // open move the mouth 0.5% at a time; Shift+R resets to defaults.
  // Default 35% top matches the current Assistant.png where her
  // lips sit ~35% down from the top of the visible character.
  const DEFAULT_MOUTH = { top: 35, left: 50 };
  const [mouthPos, setMouthPos] = useState(() => {
    try {
      const raw = localStorage.getItem("priya_mouth_pos");
      if (raw) {
        const parsed = JSON.parse(raw);
        // If the stale 28.5 default is stored from an earlier build,
        // migrate to the new default so users don't get a mouth on
        // her nose forever.
        if (parsed && parsed.top === 28.5) return DEFAULT_MOUTH;
        return parsed;
      }
    } catch (_) {}
    return DEFAULT_MOUTH;
  });
  const [showMouthGuide, setShowMouthGuide] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (!e.shiftKey) return;
      let dt = 0, dl = 0, reset = false;
      if (e.key === "ArrowUp")    dt = -0.5;
      if (e.key === "ArrowDown")  dt = +0.5;
      if (e.key === "ArrowLeft")  dl = -0.5;
      if (e.key === "ArrowRight") dl = +0.5;
      if (e.key === "R" || e.key === "r") reset = true;
      if (!dt && !dl && !reset) return;
      e.preventDefault();
      setShowMouthGuide(true);
      setMouthPos((p) => {
        const next = reset ? DEFAULT_MOUTH : { top: p.top + dt, left: p.left + dl };
        try { localStorage.setItem("priya_mouth_pos", JSON.stringify(next)); } catch (_) {}
        return next;
      });
      // Hide the guide 3s after last nudge.
      clearTimeout(window.__priyaMouthGuideT);
      window.__priyaMouthGuideT = setTimeout(() => setShowMouthGuide(false), 3000);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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

      {/* Character container — either the live D-ID stream or the
          static-image fallback. Static fallback preserves the full
          previous experience (amplitude-driven CSS motion) so users
          on an offline LAN still get a working chatbot. */}
      {useLiveAvatar ? (
        <div style={S.charWrap}>
          <LeaveAssistantAvatar
            state={avatarState}
            audioBlob={ttsBlob}
            onFail={() => setAvatarFailed(true)}
          />
        </div>
      ) : (
      <div style={S.charWrap}>
        {/* State-coloured aura ring behind the character.
            Aura also pulses with real audio amplitude while speaking,
            not just a canned 3s CSS loop. */}
        <div
          style={{
            ...S.aura,
            ...S.auraByState[stateKind],
            transform:
              stateKind === "speaking"
                ? `translate(-50%, -50%) scale(${1 + speakAmp * 0.25})`
                : undefined,
            opacity: stateKind === "speaking" ? 0.5 + speakAmp * 0.5 : undefined,
          }}
        />

        {/* Breathing wrapper — subtle scale on idle, audio-amplitude
            driven head bob + head-tilt when speaking. A time-based
            sinusoidal sway is added into the same transform so she
            keeps moving even when the voice goes quiet between
            syllables (Talking-Tom energy: always alive). */}
        <div
          className={`priya-breathe ${stateKind}`}
          style={
            stateKind === "speaking"
              ? (() => {
                  // Ambient sway that runs regardless of amplitude —
                  // low freq (~0.5Hz), tiny (2px / 1deg). speakAmp
                  // adds the loud-syllable jolt on top.
                  const t = Date.now() / 1000;
                  const swayY = Math.sin(t * 3.1) * 2;         // 2px vertical
                  const swayX = Math.sin(t * 2.3) * 3;         // 3px horizontal
                  const swayR = Math.sin(t * 1.7) * 0.8;       // 0.8deg tilt
                  return {
                    transform: `
                      translateY(${-speakAmp * 14 + swayY}px)
                      translateX(${(speakAmp - 0.5) * 4 + swayX}px)
                      rotate(${(speakAmp - 0.5) * 3 + swayR}deg)
                      scale(${1 + speakAmp * 0.03})
                    `,
                    transition: "transform 50ms linear",
                    transformOrigin: "bottom center",
                  };
                })()
              : undefined
          }
        >
          <img
            src={imgSrc}
            onError={() => imgSrc === AVATAR_FULL_SRC && setImgSrc(AVATAR_FALLBACK_SRC)}
            alt={agentName}
            style={S.charImg}
          />

          {/* Talking-Tom mouth: two stacked ellipses positioned over
              her lips. The DARK one is the mouth cavity (opens
              vertically with amplitude). The LIGHT one on top is a
              thin lip highlight so at rest her mouth still reads as
              lips, not a black hole.
              Position via inline top/left — tweak the two numbers
              below (mouthTopPct / mouthLeftPct) if the mouth doesn't
              land on her actual lips in your build. */}
          {(stateKind === "speaking" || showMouthGuide) && (() => {
            const mouthTopPct  = mouthPos.top;    // tune with Shift+↑/↓
            const mouthLeftPct = mouthPos.left;   // tune with Shift+←/→
            // Wide + short ellipse = mouth shape. Height jumps big
            // per amplitude (jaw drop), width stays fairly constant
            // (only a small vowel-shape variation).
            const amp = stateKind === "speaking" ? speakAmp : 0.4;
            const openW = 55 + amp * 20;   // 55–75px wide
            const openH = 4  + amp * 24;   // 4–28px tall (jaw drop)
            return (
              <>
                {/* Dark mouth cavity — inside of mouth */}
                <div
                  style={{
                    position: "absolute",
                    top:  `${mouthTopPct}%`,
                    left: `${mouthLeftPct}%`,
                    width:  openW,
                    height: openH,
                    borderRadius: "50%",
                    background:
                      "radial-gradient(ellipse at center 45%, #0a0104 0%, #2a0510 55%, rgba(42,5,16,0) 100%)",
                    transform: "translate(-50%, -50%)",
                    zIndex: 3,
                    pointerEvents: "none",
                    boxShadow:
                      amp > 0.2
                        ? `inset 0 ${1 + amp * 3}px ${3 + amp * 4}px rgba(0,0,0,0.75)`
                        : "none",
                    transition: "width 50ms linear, height 50ms linear",
                  }}
                />
                {/* Faint teeth hint — only visible when mouth is
                    fairly open (amp > 0.35). Thin light strip near
                    the top of the cavity fakes upper teeth. */}
                {amp > 0.35 && (
                  <div
                    style={{
                      position: "absolute",
                      top:  `calc(${mouthTopPct}% - ${openH * 0.2}px)`,
                      left: `${mouthLeftPct}%`,
                      width:  openW * 0.7,
                      height: 2,
                      borderRadius: 2,
                      background: "rgba(255,240,235,0.35)",
                      transform: "translate(-50%, -50%)",
                      zIndex: 4,
                      pointerEvents: "none",
                      filter: "blur(0.4px)",
                    }}
                  />
                )}
                {/* Lip-line — thin dark line, always visible so at
                    low amplitude her lips still read as lips. */}
                <div
                  style={{
                    position: "absolute",
                    top:  `${mouthTopPct}%`,
                    left: `${mouthLeftPct}%`,
                    width:  openW * 1.02,
                    height: 2,
                    borderRadius: 2,
                    background: "rgba(60,10,20,0.6)",
                    transform: "translate(-50%, -50%)",
                    zIndex: 4,
                    pointerEvents: "none",
                    opacity: 1 - amp * 0.6,
                  }}
                />
                {/* Calibration guide — crosshair + coords, shown
                    briefly while nudging with Shift+arrows. */}
                {showMouthGuide && (
                  <div
                    style={{
                      position: "absolute",
                      top:  `${mouthTopPct}%`,
                      left: `${mouthLeftPct}%`,
                      transform: "translate(-50%, -50%)",
                      width: 100, height: 100,
                      border: "1px dashed rgba(255,255,255,0.7)",
                      borderRadius: "50%",
                      zIndex: 5,
                      pointerEvents: "none",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontSize: 10, fontWeight: 700,
                      background: "rgba(0,0,0,0.35)",
                    }}
                  >
                    <div style={{ textAlign: "center", lineHeight: 1.3 }}>
                      top:{mouthPos.top.toFixed(1)}%<br />
                      left:{mouthPos.left.toFixed(1)}%
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Speaking waveform — 24 bars, height driven by real amplitude */}
        {stateKind === "speaking" && (
          <div style={S.waveWrap} aria-hidden="true">
            {Array.from({ length: 24 }).map((_, i) => {
              // Give each bar a slightly different phase so the wall
              // isn't a flat rectangle — a tiny per-bar sine keeps the
              // "wave" feeling even when amplitude is uniform.
              const jitter = 0.5 + 0.5 * Math.sin((i / 24) * Math.PI * 2 + speakAmp * 6);
              return (
                <span
                  key={i}
                  className="priya-wave-bar"
                  style={{ transform: `scaleY(${0.15 + speakAmp * jitter * 1.2})` }}
                />
              );
            })}
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
      )}

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
      @keyframes priyaListenLean {
        0%, 100% { transform: translateY(0)    rotate(0deg); }
        50%      { transform: translateY(-2px) rotate(-0.8deg); }
      }
      @keyframes priyaAuraPulse {
        0%   { opacity: 0.55; transform: translate(-50%, -50%) scale(0.98); }
        50%  { opacity: 0.85; transform: translate(-50%, -50%) scale(1.05); }
        100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.98); }
      }
      @keyframes priyaThinkDot {
        0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
        40%           { opacity: 1;   transform: translateY(-4px); }
      }
      .priya-breathe { animation: priyaBreathe 4s ease-in-out infinite; position: relative; }
      .priya-breathe.listening { animation: priyaListenLean 2.2s ease-in-out infinite; }
      .priya-breathe.thinking  { animation: priyaBreathe 2s ease-in-out infinite; }
      /* Speaking state: no CSS animation on transform — the inline
         style in the render sets transform each frame from real
         audio amplitude. A CSS animation on the same property would
         win the specificity fight and freeze the lip-sync. */
      .priya-breathe.speaking  { animation: none; transform-origin: bottom center; }
      /* Wave bars now driven by inline transform (scaleY from amp).
         Keep the base bar shape here; skip the keyframe. */
      .priya-wave-bar {
        display: inline-block; width: 4px; height: 40px;
        background: linear-gradient(180deg, #ef4444, #7a1022);
        margin: 0 2px; border-radius: 2px; transform-origin: center bottom;
        transition: transform 60ms linear;
      }
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
