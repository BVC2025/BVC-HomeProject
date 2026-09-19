// React hook that owns a single D-ID WebRTC session for one Leave
// chatbot open→close lifetime.
//
// Responsibilities:
//   • Open a stream against our /avatar-session proxy on mount.
//   • Negotiate the WebRTC handshake (SDP + trickle ICE).
//   • Expose the incoming <video> MediaStream so a <video> tag can
//     paint the avatar frames.
//   • Provide speak(audioBlob) so callers can push a Sarvam TTS reply
//     into the already-open pipe.
//   • Cleanly tear down on unmount / panel close — D-ID bills per
//     streamed second, so orphaned streams cost real money.
//
// Not owned here: state machine (idle/listening/thinking/speaking),
// audio playback for the user's own ears, or business logic. Those
// stay in LeaveAssistantAvatar / LeaveAIAssistant.

import { useCallback, useEffect, useRef, useState } from "react";
import { avatarSession } from "../../services/avatarSessionService";
import { setDidReady } from "./didStreamRegistry";

// D-ID stream states, mapped 1:1 to what the UI cares about.
export const STREAM_STATUS = {
  IDLE:        "idle",         // hook mounted, nothing opened yet
  CONNECTING:  "connecting",   // in the middle of WebRTC negotiation
  CONNECTED:   "connected",    // handshake done, waiting for speak()
  STREAMING:   "streaming",    // D-ID is actively sending video frames
  ERROR:       "error",        // negotiation or media error; UI falls back
  CLOSED:      "closed",       // teardown complete
};


export function useDIDStream({ enabled, sourceUrl, onError }) {
  const [status,      setStatus]      = useState(STREAM_STATUS.IDLE);
  const [videoStream, setVideoStream] = useState(null);

  // Refs — WebRTC state that shouldn't trigger re-renders.
  const pcRef        = useRef(null);
  const streamIdRef  = useRef(null);
  const sessionIdRef = useRef(null);
  const isMountedRef = useRef(true);
  // Queue for speak() calls made before the WebRTC connection is
  // fully established. The welcome greeting fires ~350ms after
  // chatbot open, but WebRTC handshake usually takes ~1-2s — so
  // without queueing the welcome audio is silently dropped and
  // D-ID never sends any video frames (video stays black). Flushed
  // once iceConnectionState hits 'connected'.
  const pendingBlobsRef = useRef([]);
  const isReadyRef      = useRef(false);

  // Cleanup: close peer connection + tell D-ID to release the slot.
  // Called on unmount AND before re-opening if `enabled` toggles.
  const cleanup = useCallback(async () => {
    const pc  = pcRef.current;
    const sid = streamIdRef.current;
    const ses = sessionIdRef.current;

    pcRef.current         = null;
    streamIdRef.current   = null;
    sessionIdRef.current  = null;
    isReadyRef.current    = false;
    pendingBlobsRef.current = [];
    setDidReady(false);  // Sarvam <audio> can go audible again after cleanup

    if (pc) {
      try {
        pc.getSenders().forEach((s) => s.track && s.track.stop());
        pc.close();
      } catch (_) {}
    }
    if (sid && ses) {
      await avatarSession.closeStream(sid, ses);
    }
    if (isMountedRef.current) {
      setVideoStream(null);
      setStatus(STREAM_STATUS.CLOSED);
    }
  }, []);

  // Send a Sarvam TTS MP3 to the open stream. Safe to call while
  // connecting — will silently no-op until the stream is ready.
  // Internal: fire a single blob to D-ID. Assumes stream is ready.
  // A single failing speak() does NOT tear down the whole avatar
  // (used to call onError which triggered the static-image
  // fallback for the rest of the session). Just log and skip;
  // next reply will retry.
  const _postSpeak = useCallback(async (audioBlob) => {
    const sid = streamIdRef.current;
    const ses = sessionIdRef.current;
    if (!sid || !ses) return;
    try {
      console.log("[avatar] speak → posting audio to backend", { bytes: audioBlob.size, type: audioBlob.type });
      setStatus(STREAM_STATUS.STREAMING);
      await avatarSession.speakAudio(sid, ses, audioBlob);
      console.log("[avatar] speak ← backend accepted, expect frames soon");
    } catch (e) {
      // Non-fatal: keep stream open, don't call onError.
      console.warn("[avatar] speak failed (non-fatal, stream stays open):", e?.message || e);
    }
  }, []);

  // Public: queue or fire based on connection readiness.
  const speak = useCallback((audioBlob) => {
    if (!audioBlob || !audioBlob.size) { console.warn("[avatar] speak called with empty blob"); return; }
    if (!isReadyRef.current) {
      // Not connected yet — queue and flush on connected event.
      console.log("[avatar] speak queued (stream not ready yet)");
      pendingBlobsRef.current.push(audioBlob);
      return;
    }
    _postSpeak(audioBlob);
  }, [_postSpeak]);

  // The negotiation runs once whenever `enabled` flips to true.
  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return undefined;

    let cancelled = false;

    async function negotiate() {
      setStatus(STREAM_STATUS.CONNECTING);
      // Debug logging — prefixed so it's greppable in DevTools Console.
      // Remove or downgrade to console.debug once the avatar is stable.
      const log = (...a) => console.log("[avatar]", ...a);
      try {
        // 1. Open the D-ID stream via our proxy.
        log("createStream → calling backend");
        const { id, offer, ice_servers, session_id } =
          await avatarSession.createStream(sourceUrl);
        log("createStream ← got id/session", { id, session_id, ice_servers_count: ice_servers?.length });
        if (cancelled) return;
        streamIdRef.current  = id;
        sessionIdRef.current = session_id;

        // 2. Build the RTCPeerConnection with the ICE servers D-ID
        // gave us (TURN creds included so NAT traversal works).
        const pc = new RTCPeerConnection({ iceServers: ice_servers });
        pcRef.current = pc;

        // 3. When a track arrives, expose it as the videoStream.
        // D-ID sends one video + one audio track on the same stream.
        pc.ontrack = (event) => {
          log("ontrack fired", { kind: event.track?.kind, streamCount: event.streams?.length });
          if (event.streams && event.streams[0]) {
            if (isMountedRef.current) setVideoStream(event.streams[0]);
          }
        };

        // 4. Trickle ICE — send each candidate as it's discovered.
        pc.onicecandidate = (event) => {
          const sid = streamIdRef.current;
          const ses = sessionIdRef.current;
          if (!sid || !ses) return;
          // event.candidate is null when trickling is done — D-ID
          // wants that signal too.
          avatarSession.sendIce(sid, ses, event.candidate).catch(() => {});
        };

        // 5. Track connection state — flip STREAMING↔CONNECTED for UI hints.
        // On first 'connected' state, flush any queued speak() blobs
        // (welcome greeting fires before handshake completes).
        pc.oniceconnectionstatechange = () => {
          log("iceConnectionState →", pc.iceConnectionState);
          if (!isMountedRef.current) return;
          if (pc.iceConnectionState === "connected" && !isReadyRef.current) {
            isReadyRef.current = true;
            // Tell the rest of the app that D-ID owns audio playback
            // now — LeaveAIAssistant will mute the Sarvam <audio>
            // element so we don't get double-audio + lip-sync drift.
            setDidReady(true);
            const queued = pendingBlobsRef.current.splice(0);
            if (queued.length) {
              log(`flushing ${queued.length} queued speak blob(s)`);
              // Only replay the most recent — if two greetings queued
              // during handshake, second one is what the user cares
              // about, first would be stale.
              _postSpeak(queued[queued.length - 1]);
            }
          }
          if (pc.iceConnectionState === "failed" ||
              pc.iceConnectionState === "disconnected") {
            setDidReady(false);
            setStatus(STREAM_STATUS.ERROR);
          }
        };
        pc.onconnectionstatechange = () => log("connectionState →", pc.connectionState);

        // 6. Apply D-ID's SDP offer + send our answer back.
        log("setRemoteDescription (D-ID offer)");
        await pc.setRemoteDescription(offer);
        log("createAnswer");
        const answer = await pc.createAnswer();
        log("setLocalDescription (our answer)");
        await pc.setLocalDescription(answer);
        if (cancelled) return;
        log("sending SDP answer to backend");
        await avatarSession.sendSdp(id, session_id, answer);
        log("SDP negotiation complete → waiting for ICE + tracks");

        if (isMountedRef.current) setStatus(STREAM_STATUS.CONNECTED);
      } catch (e) {
        console.error("[avatar] negotiate failed:", e);
        if (cancelled) return;
        onError?.(e);
        if (isMountedRef.current) setStatus(STREAM_STATUS.ERROR);
      }
    }
    negotiate();

    return () => {
      cancelled = true;
      cleanup();
    };
    // sourceUrl / onError intentionally omitted — a stream is per-open
    // and shouldn't tear down mid-conversation when a parent memoizes
    // the callback shallowly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Unmount safety
  useEffect(() => () => { isMountedRef.current = false; }, []);

  return { status, videoStream, speak, cleanup };
}
