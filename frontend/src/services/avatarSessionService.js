// Client for the /avatar-session/* backend proxy that fronts D-ID's
// Streams API. All D-ID secrets stay on the server; this file only
// talks to our own backend. Errors bubble up as thrown Errors with
// the D-ID payload attached — the caller decides how to surface them
// (usually: fall back to the static Priya image).

import API from "./api";

const BASE = "/avatar-session";

export const avatarSession = {
  /** Cheap probe — is DID_API_KEY configured on the backend? */
  async health() {
    const { data } = await API.get(`${BASE}/health`);
    return data; // { enabled, provider, presenter_url }
  },

  /** Open a new WebRTC stream. Returns { id, offer, ice_servers, session_id }. */
  async createStream(sourceUrl) {
    const { data } = await API.post(`${BASE}/stream`, {
      source_url: sourceUrl || null,
    });
    return data;
  },

  /** Send the browser's SDP answer to D-ID via our proxy. */
  async sendSdp(streamId, sessionId, answer) {
    const { data } = await API.post(`${BASE}/stream/${streamId}/sdp`, {
      answer,
      session_id: sessionId,
    });
    return data;
  },

  /** Trickle an ICE candidate. null candidate = end-of-candidates signal. */
  async sendIce(streamId, sessionId, candidate) {
    const body = { session_id: sessionId };
    if (candidate) {
      body.candidate     = candidate.candidate;
      body.sdpMid        = candidate.sdpMid;
      body.sdpMLineIndex = candidate.sdpMLineIndex;
    }
    const { data } = await API.post(`${BASE}/stream/${streamId}/ice`, body);
    return data;
  },

  /** Hand D-ID the MP3 blob to lip-sync (the reply the user just heard). */
  async speakAudio(streamId, sessionId, audioBlob, filename = "reply.mp3") {
    const fd = new FormData();
    fd.append("session_id", sessionId);
    fd.append("file", audioBlob, filename);
    const { data } = await API.post(`${BASE}/stream/${streamId}/audio`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 25000,
    });
    return data;
  },

  /** Release the D-ID slot. Billed per streamed second, so call it. */
  async closeStream(streamId, sessionId) {
    try {
      await API.delete(`${BASE}/stream/${streamId}`, {
        params: { session_id: sessionId },
      });
    } catch (_) {
      // Best-effort cleanup — if the network's already gone we've
      // done what we can. D-ID also idles unused streams out.
    }
  },
};
