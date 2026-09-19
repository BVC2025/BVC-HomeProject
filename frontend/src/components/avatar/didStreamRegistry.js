// Tiny cross-module registry for D-ID stream readiness.
//
// Purpose: LeaveAIAssistant needs to know when the D-ID WebRTC stream
// is fully connected so it can MUTE the Sarvam <audio> playback
// (letting the D-ID stream's own audio track — which is perfectly
// synced with D-ID's rendered video — be the only audio the user
// hears). Without this, Sarvam's audio + D-ID's audio play
// simultaneously and lip-sync drifts by the D-ID render latency
// (~500-1500ms).
//
// Pattern mirrors the pub-sub in LeaveAIAssistant (onSpeakingChange
// etc.) so behaviour stays consistent across the app.

let _ready = false;
const _listeners = new Set();

export function setDidReady(v) {
  const next = !!v;
  if (next === _ready) return;
  _ready = next;
  for (const cb of _listeners) { try { cb(_ready); } catch (_) {} }
}

export function getDidReady() {
  return _ready;
}

export function onDidReadyChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
