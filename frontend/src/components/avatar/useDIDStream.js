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

  // Cleanup: close peer connection + tell D-ID to release the slot.
  // Called on unmount AND before re-opening if `enabled` toggles.
  const cleanup = useCallback(async () => {
    const pc  = pcRef.current;
    const sid = streamIdRef.current;
    const ses = sessionIdRef.current;

    pcRef.current        = null;
    streamIdRef.current  = null;
    sessionIdRef.current = null;

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
  const speak = useCallback(async (audioBlob) => {
    const sid = streamIdRef.current;
    const ses = sessionIdRef.current;
    if (!sid || !ses) return; // not connected yet
    if (!audioBlob || !audioBlob.size) return;
    try {
      setStatus(STREAM_STATUS.STREAMING);
      await avatarSession.speakAudio(sid, ses, audioBlob);
      // D-ID will fire video frames over the existing WebRTC channel;
      // status flips back to CONNECTED on the peer 'streaming-state'
      // event (handled in the negotiation block below).
    } catch (e) {
      onError?.(e);
      setStatus(STREAM_STATUS.ERROR);
    }
  }, [onError]);

  // The negotiation runs once whenever `enabled` flips to true.
  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return undefined;

    let cancelled = false;

    async function negotiate() {
      setStatus(STREAM_STATUS.CONNECTING);
      try {
        // 1. Open the D-ID stream via our proxy.
        const { id, offer, ice_servers, session_id } =
          await avatarSession.createStream(sourceUrl);
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
        pc.oniceconnectionstatechange = () => {
          if (!isMountedRef.current) return;
          if (pc.iceConnectionState === "failed" ||
              pc.iceConnectionState === "disconnected") {
            setStatus(STREAM_STATUS.ERROR);
          }
        };

        // 6. Apply D-ID's SDP offer + send our answer back.
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (cancelled) return;
        await avatarSession.sendSdp(id, session_id, answer);

        if (isMountedRef.current) setStatus(STREAM_STATUS.CONNECTED);
      } catch (e) {
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
