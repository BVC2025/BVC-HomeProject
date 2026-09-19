"""Real-time talking-avatar proxy for the Leave assistant.

Sits between the browser and D-ID's Streams API so:
  - the D-ID secret never ships to the browser bundle
  - CORS / auth / rate limiting are enforced by our stack
  - swapping providers later (Simli, HeyGen) is a one-file change

Flow (per conversation turn):
  1. Browser: POST /avatar-session/stream       → create WebRTC stream
                                                  ← { id, offer, ice_servers, session_id }
  2. Browser negotiates WebRTC with D-ID via us:
     - POST /avatar-session/stream/{id}/sdp     (send SDP answer)
     - POST /avatar-session/stream/{id}/ice     (send ICE candidates)
  3. When Sarvam TTS reply is ready:
     - POST /avatar-session/stream/{id}/audio   (multipart: the MP3 blob)
     Backend uploads that MP3 to D-ID's /audios, then POSTs
     /talks/streams/{id} with the returned audio_url.
     D-ID streams the lip-synced video via the already-open WebRTC.
  4. On panel close / new stream:
     - DELETE /avatar-session/stream/{id}       (releases the D-ID slot)

Every route is a thin proxy — no business logic. Read the D-ID docs at
https://docs.d-id.com/reference/talks-streaming for wire-level details.
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Any, Dict, Optional

import requests
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel


router = APIRouter()
log = logging.getLogger("avatar_session")


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

DID_API_BASE = "https://api.d-id.com"
DID_API_KEY  = os.environ.get("DID_API_KEY", "").strip()

# Default face — a D-ID stock HR-professional presenter. Override per
# env var so brand can swap without a rebuild. Full presenter list:
# https://studio.d-id.com/ (browse presenters, right-click → copy URL).
DEFAULT_PRESENTER_URL = os.environ.get(
    "DID_AVATAR_PRESENTER_URL",
    "https://create-images-results.d-id.com/DefaultPresenters/Emma_f/thumbnail.jpeg",
)

# Requests to D-ID need to be fast enough that a WebRTC negotiation
# doesn't time out; well over the 30s tunnels we hit elsewhere. If
# D-ID hangs we bail early rather than propagating the wait.
DID_TIMEOUT_SECONDS = 20


def _did_headers() -> Dict[str, str]:
    """Build the Authorization header for D-ID. Their API keys are
    `<user>:<secret>` and take Basic auth of the base64 of that
    whole string as the value."""
    if not DID_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "Avatar not configured — DID_API_KEY is missing from the "
                "backend env. Add it to backend/.env and restart."
            ),
        )
    encoded = base64.b64encode(DID_API_KEY.encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {encoded}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }


def _did_call(
    method: str,
    path: str,
    *,
    json: Optional[Dict[str, Any]] = None,
    files: Optional[Dict[str, Any]] = None,
    data:  Optional[Dict[str, Any]] = None,
) -> requests.Response:
    """Single point of contact with D-ID so timeout/error handling is
    uniform. When `files` is set we drop Content-Type from the header
    so `requests` can compute the multipart boundary itself."""
    headers = _did_headers()
    if files is not None:
        headers.pop("Content-Type", None)
    try:
        r = requests.request(
            method,
            f"{DID_API_BASE}{path}",
            headers=headers,
            json=json,
            files=files,
            data=data,
            timeout=DID_TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        log.warning("D-ID request failed (%s %s): %s", method, path, e)
        raise HTTPException(
            status_code=502,
            detail=f"Avatar upstream unreachable: {e.__class__.__name__}",
        )

    # Bubble D-ID's error body up so the browser sees exactly what
    # they said (rate-limit, quota, invalid presenter, etc.) — much
    # more useful during dev than a generic 500.
    if r.status_code >= 400:
        try:
            payload = r.json()
        except Exception:
            payload = {"raw": r.text[:500]}
        log.info("D-ID %s %s → %s: %s", method, path, r.status_code, payload)
        raise HTTPException(status_code=r.status_code, detail=payload)

    return r


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------

class CreateStreamRequest(BaseModel):
    # Allow the frontend to pick a presenter per-call; falls back to
    # the env default. Useful if you later expose "choose your avatar"
    # in the UI.
    source_url: Optional[str] = None


class SdpBody(BaseModel):
    answer:     Dict[str, Any]
    session_id: str


class IceBody(BaseModel):
    candidate:    Optional[str] = None
    sdpMid:       Optional[str] = None
    sdpMLineIndex: Optional[int] = None
    session_id:   str


# ---------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------

@router.get("/health")
def health() -> Dict[str, Any]:
    """Cheap check for the frontend to know whether to try D-ID at all
    or fall back to the static Priya image immediately (no round-trip
    to D-ID)."""
    return {
        "enabled":       bool(DID_API_KEY),
        "provider":      "did",
        "presenter_url": DEFAULT_PRESENTER_URL if DID_API_KEY else None,
    }


@router.post("/stream")
def create_stream(body: CreateStreamRequest) -> Dict[str, Any]:
    """Open a new WebRTC stream against D-ID.

    Returns the SDP offer + ICE servers the browser needs to complete
    the WebRTC handshake."""
    source_url = body.source_url or DEFAULT_PRESENTER_URL
    r = _did_call("POST", "/talks/streams", json={"source_url": source_url})
    data = r.json()
    # Trim to just what the browser needs — session_id in particular
    # must be passed back on every subsequent call (D-ID validates it).
    return {
        "id":          data.get("id"),
        "offer":       data.get("offer"),
        "ice_servers": data.get("ice_servers"),
        "session_id":  data.get("session_id"),
    }


@router.post("/stream/{stream_id}/sdp")
def stream_sdp(stream_id: str, body: SdpBody) -> Dict[str, Any]:
    """Send the browser's SDP answer back to D-ID to complete the
    WebRTC negotiation."""
    r = _did_call(
        "POST",
        f"/talks/streams/{stream_id}/sdp",
        json={"answer": body.answer, "session_id": body.session_id},
    )
    return r.json() if r.text else {"ok": True}


@router.post("/stream/{stream_id}/ice")
def stream_ice(stream_id: str, body: IceBody) -> Dict[str, Any]:
    """Trickle an ICE candidate to D-ID as the browser discovers them."""
    payload = {"session_id": body.session_id}
    # D-ID accepts the null 'end-of-candidates' signal as a body with
    # just the session_id; pass candidate fields only when present.
    if body.candidate is not None:
        payload["candidate"]     = body.candidate
        payload["sdpMid"]        = body.sdpMid
        payload["sdpMLineIndex"] = body.sdpMLineIndex
    r = _did_call("POST", f"/talks/streams/{stream_id}/ice", json=payload)
    return r.json() if r.text else {"ok": True}


@router.post("/stream/{stream_id}/audio")
def stream_audio(
    stream_id: str,
    session_id: str = Form(...),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """Send a Sarvam-TTS MP3 blob to D-ID so it lip-syncs the avatar
    to that exact audio.

    Two-step per D-ID Streams contract:
      1) Upload the audio to /audios → get a public URL
      2) POST /talks/streams/{id} with script.type='audio' + audio_url
         (D-ID streams the video via the already-open WebRTC pipe)."""

    audio_bytes = file.file.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio upload.")

    # Step 1 — upload MP3 to D-ID storage.
    up = _did_call(
        "POST",
        "/audios",
        files={"audio": (file.filename or "reply.mp3", audio_bytes, file.content_type or "audio/mpeg")},
    )
    audio_url = up.json().get("url")
    if not audio_url:
        raise HTTPException(502, "D-ID did not return an audio URL.")

    # Step 2 — tell the open stream to speak that audio.
    r = _did_call(
        "POST",
        f"/talks/streams/{stream_id}",
        json={
            "script": {"type": "audio", "audio_url": audio_url},
            "session_id": session_id,
            "config": {
                # Modest padding around each utterance so the avatar
                # settles back to a neutral pose between replies
                # rather than snapping shut mid-frame.
                "fluent":      True,
                "pad_audio":   0.1,
                "stitch":      True,
            },
        },
    )
    return {"ok": True, "response": r.json() if r.text else None}


@router.delete("/stream/{stream_id}")
def delete_stream(stream_id: str, session_id: str) -> Dict[str, Any]:
    """Tell D-ID we're done — releases the streaming slot (billed by
    seconds of streamed video, so promptly closing matters)."""
    r = _did_call(
        "DELETE",
        f"/talks/streams/{stream_id}",
        json={"session_id": session_id},
    )
    return {"ok": True, "response": r.json() if r.text else None}
