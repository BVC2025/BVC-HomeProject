"""Offline TTS endpoint (Piper) — used by the AI Playground's voice
feature. Synthesis only; playback happens client-side, so there is no
/stop route here (stopping is just pausing the browser's <audio> element)."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.auth.auth_bearer import get_current_user
from app.rag_modules.core.language_registry import LANGUAGE_PATTERN
from app.services.speech_service import speech_service, SpeechServiceUnavailable

router = APIRouter(prefix="/speech", tags=["Speech (TTS)"])


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    language: str = Field(..., pattern=LANGUAGE_PATTERN)


@router.post("/speak", dependencies=[Depends(get_current_user)])
def speak(payload: SpeakRequest):

    try:

        wav_bytes = speech_service.speak(payload.text, payload.language)

    except SpeechServiceUnavailable as e:

        raise HTTPException(status_code=503, detail=str(e))

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    return Response(content=wav_bytes, media_type="audio/wav")
