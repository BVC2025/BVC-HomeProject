"""Offline TTS endpoint (Piper, + optional Kokoro) — used by the AI
Playground's voice feature and the ERP-wide assistant widget. Synthesis
only; playback happens client-side, so there is no /stop route here
(stopping is just pausing the browser's <audio> element)."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.auth.auth_bearer import get_current_user
from app.rag_modules.core.language_registry import LANGUAGE_PATTERN
from app.services.speech_service import speech_service, SpeechServiceUnavailable
from app.services.kokoro_speech_service import kokoro_speech_service, KokoroUnavailable

log = logging.getLogger("uvicorn")

router = APIRouter(prefix="/speech", tags=["Speech (TTS)"])


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    language: str = Field(..., pattern=LANGUAGE_PATTERN)
    engine: Literal["piper", "kokoro"] = "piper"


@router.post("/speak", dependencies=[Depends(get_current_user)])
def speak(payload: SpeakRequest):

    if payload.engine == "kokoro" and kokoro_speech_service.is_supported(payload.language):

        try:

            return Response(
                content=kokoro_speech_service.speak(payload.text, payload.language),
                media_type="audio/wav",
            )

        except KokoroUnavailable as e:

            # Fall back to Piper below rather than erroring — a caller
            # that just wants *a* voice back shouldn't need to know or
            # care that Kokoro isn't installed/working right now.
            log.warning("Kokoro TTS unavailable, falling back to Piper: %s", e)

    try:

        wav_bytes = speech_service.speak(payload.text, payload.language)

    except SpeechServiceUnavailable as e:

        raise HTTPException(status_code=503, detail=str(e))

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    return Response(content=wav_bytes, media_type="audio/wav")
