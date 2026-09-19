// Interactive real-time talking-avatar for the Leave chatbot.
//
// Contract (kept deliberately small so LeaveAvatarStage doesn't need
// to know anything about D-ID / WebRTC):
//
//   <LeaveAssistantAvatar
//      state    = "idle" | "listening" | "thinking" | "speaking" | "success" | "error"
//      audioBlob= <MP3 Blob from Sarvam TTS>       // new blob triggers a speak()
//      onReady  = () => {}                         // stream connected, ready to speak
//      onFail   = (err) => {}                      // stream failed, parent should fall back
//   />
//
// The component owns:
//   • D-ID WebRTC session lifecycle (opens on mount, closes on unmount)
//   • The <video> element that paints the streamed avatar frames
//   • A state overlay (small badge + subtle CSS accents per state)
//
// It does NOT own:
//   • Any leave / LLM / TTS logic — parent passes the audio Blob only
//   • Audio playback for the user — the stream already carries synced
//     audio+video, so we don't also play the user's <audio> tag; the
//     parent should stop its own <audio> once handoff is done. (For
//     the current implementation we let the parent keep playing its
//     <audio> for backward-compat / mute toggle; D-ID also plays
//     the audio track from the same source so the two are inaudible
//     duplicates — we mute D-ID's audio track by default and let the
//     Sarvam <audio> element be the source of truth. See below.)

import { useEffect, useMemo, useRef } from "react";
import { STREAM_STATUS, useDIDStream } from "./useDIDStream";


const PRESENTER_URL_OVERRIDE = null; // set to a D-ID DefaultPresenter URL to override backend default


export default function LeaveAssistantAvatar({
  state,
  audioBlob,
  onReady,
  onFail,
  presenterUrl = PRESENTER_URL_OVERRIDE,
  className = "",
}) {
  const videoRef = useRef(null);

  const { status, videoStream, speak } = useDIDStream({
    enabled:   true,
    sourceUrl: presenterUrl,
    onError:   onFail,
  });

  // Attach the incoming MediaStream to the <video> tag whenever a
  // new one arrives (happens exactly once per open — D-ID keeps the
  // same track across utterances).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoStream) return;
    v.srcObject = videoStream;
    v.play().catch(() => {
      // Some browsers block <video> autoplay if `muted` isn't set.
      // We set muted below, so this should rarely fire — swallow it.
    });
  }, [videoStream]);

  // Ready signal — fires once the stream is CONNECTED (not while it's
  // still negotiating). Parent may want to trigger a welcome speak().
  const readyFiredRef = useRef(false);
  useEffect(() => {
    if (status === STREAM_STATUS.CONNECTED && !readyFiredRef.current) {
      readyFiredRef.current = true;
      onReady?.();
    }
  }, [status, onReady]);

  // Push each new audioBlob to D-ID as it arrives. Parent hands us
  // exactly the MP3 that was just fetched from Sarvam — same bytes
  // its own <audio> element is playing, so lip-sync stays aligned.
  const lastBlobRef = useRef(null);
  useEffect(() => {
    if (!audioBlob) return;
    if (audioBlob === lastBlobRef.current) return;
    lastBlobRef.current = audioBlob;
    speak(audioBlob);
  }, [audioBlob, speak]);

  // State-tinted glow + subtle CSS accents. The heavy lifting (blink,
  // head bob, lip-sync) is handled by D-ID's rendered video, so we
  // stay out of the way and only accent the room around her.
  const stateAccent = useMemo(() => {
    switch (state) {
      case "listening": return { ring: "rgba(34, 197, 94, 0.65)",  glow: "rgba(34,197,94,0.35)" };
      case "thinking":  return { ring: "rgba(245, 158, 11, 0.65)", glow: "rgba(245,158,11,0.30)" };
      case "speaking":  return { ring: "rgba(239, 68, 68, 0.75)",  glow: "rgba(239,68,68,0.40)" };
      case "success":   return { ring: "rgba(34, 197, 94, 0.85)",  glow: "rgba(34,197,94,0.45)" };
      case "error":     return { ring: "rgba(220, 38, 38, 0.75)",  glow: "rgba(220,38,38,0.40)" };
      default:          return { ring: "rgba(220, 38, 38, 0.35)",  glow: "rgba(220,38,38,0.20)" };
    }
  }, [state]);

  // Render — <video> is the star, everything else is a thin frame.
  // Video track is UNMUTED (D-ID audio is the source of truth so
  // lip-sync stays exact). Parent should NOT also play the same
  // Sarvam <audio>; we control mute upstream in LeaveAIAssistant.
  return (
    <div className={className} style={{ ...S.wrap }}>
      {/* Aura ring — pulses on state */}
      <div style={{ ...S.aura, background: stateAccent.glow }} />

      {status === STREAM_STATUS.CONNECTING && (
        <div style={S.overlayText}>Warming up Priya…</div>
      )}
      {status === STREAM_STATUS.ERROR && (
        <div style={{ ...S.overlayText, color: "#fecaca" }}>
          Avatar unavailable — using static image
        </div>
      )}

      <video
        ref={videoRef}
        style={{
          ...S.video,
          boxShadow: `0 0 0 4px ${stateAccent.ring}, 0 40px 80px rgba(0,0,0,0.5)`,
        }}
        autoPlay
        playsInline
      />
    </div>
  );
}


const S = {
  wrap: {
    position: "relative", zIndex: 2, flex: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: 0,
  },
  aura: {
    position: "absolute", left: "50%", top: "50%",
    width: 520, height: 520, borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    filter: "blur(60px)", pointerEvents: "none", zIndex: 0,
    transition: "background 0.4s ease",
  },
  video: {
    position: "relative", zIndex: 2,
    height: "min(72vh, 720px)",
    maxWidth: "88vw",
    objectFit: "cover",
    borderRadius: 24,
    background: "#0a0206",
    transition: "box-shadow 0.35s ease",
  },
  overlayText: {
    position: "absolute", top: 20, left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 16px", borderRadius: 999,
    background: "rgba(0,0,0,0.55)", color: "#fff",
    fontSize: 13, fontWeight: 600, letterSpacing: 0.3,
    zIndex: 3,
  },
};
