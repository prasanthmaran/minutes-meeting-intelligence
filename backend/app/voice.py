"""ElevenLabs speech I/O. Audio and keys are kept out of application logs/storage."""

import logging
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Meeting, Message, get_db
from . import stored_settings

router = APIRouter(prefix="/api")
settings = get_settings()
log = logging.getLogger(__name__)
MAX_AUDIO = 5_000_000


def local_request(request: Request):
    if request.headers.get("X-Local-Settings") != "1":
        raise HTTPException(403, "Use the voice controls in the local app.")
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise HTTPException(403, "Unknown origin.")


def headers():
    if not settings.elevenlabs_api_key.get_secret_value():
        raise HTTPException(409, "Connect ElevenLabs in Settings → Voice first.")
    return {"xi-api-key": settings.elevenlabs_api_key.get_secret_value()}


def failure(exc):
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in (401, 403):
        return "ElevenLabs rejected the key or permission. Check speech-to-text, text-to-speech, and voice-read access."
    if status in (402, 429):
        return "ElevenLabs credits or rate limit reached. Check your account and retry."
    return "ElevenLabs could not complete the voice request. Check connectivity, model, and voice access."


class VoiceConnection(BaseModel):
    api_key: SecretStr = Field(exclude=True)


@router.get("/voice/status")
def status():
    return {
        "connected": bool(settings.elevenlabs_api_key.get_secret_value()),
        "voice_id": settings.elevenlabs_voice_id,
        "model": settings.elevenlabs_tts_model,
    }


@router.post("/settings/elevenlabs", dependencies=[Depends(local_request)])
def connect(body: VoiceConnection, db: Session = Depends(get_db)):
    key = body.api_key.get_secret_value().strip()
    if not key or len(key) > 500:
        raise HTTPException(422, "Enter a valid ElevenLabs API key.")
    try:
        with httpx.Client(timeout=30) as client:
            response = client.get(
                "https://api.elevenlabs.io/v2/voices",
                headers={"xi-api-key": key},
                params={"page_size": 20},
            )
            response.raise_for_status()
            voices = response.json().get("voices", [])
        voices = [
            {"id": v["voice_id"], "name": v.get("name", "Voice")}
            for v in voices
            if re.fullmatch(r"[A-Za-z0-9_-]{1,100}", v.get("voice_id", ""))
        ]
        if not voices:
            raise HTTPException(
                422,
                "No voices are available to this key. Enable voice-read access or add an available voice in ElevenLabs.",
            )
        preferred = next((v for v in voices if v["id"] == settings.elevenlabs_voice_id), voices[0])
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("voice_connection_failed error_type=%s", type(exc).__name__)
        raise HTTPException(502, failure(exc)) from exc
    # Saved encrypted so restarts keep it; never returned to the browser.
    stored_settings.save(db, elevenlabs_api_key=key, elevenlabs_voice_id=preferred["id"])
    settings.elevenlabs_api_key = SecretStr(key)
    settings.elevenlabs_voice_id = preferred["id"]
    return {"connected": True, "voice_id": preferred["id"], "voice_name": preferred["name"]}


@router.post("/meetings/{meeting_id}/voice/transcribe", dependencies=[Depends(local_request)])
def transcribe(meeting_id: str, file: UploadFile, db: Session = Depends(get_db)):
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(404, "Meeting not found.")
    if settings.ai_mode == "demo" or meeting.status != "ready":
        raise HTTPException(
            409, "Connect the AI provider and wait for this meeting to be ready first."
        )
    auth = headers()
    media_type = (file.content_type or "").split(";")[0]
    extensions = {
        "audio/webm": "webm",
        "audio/mp4": "m4a",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/mpeg": "mp3",
    }
    if media_type not in extensions:
        raise HTTPException(415, "Use a supported audio recording (WebM, MP4, Ogg, WAV, or MP3).")
    data = file.file.read(MAX_AUDIO + 1)
    if len(data) > MAX_AUDIO:
        raise HTTPException(413, "Voice questions must be under 5 MB.")
    if not data:
        raise HTTPException(422, "The recording is empty. Record your question again.")
    try:
        with httpx.Client(timeout=90) as client:
            response = client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers=auth,
                data={
                    "model_id": settings.elevenlabs_stt_model,
                    "tag_audio_events": "false",
                    "diarize": "false",
                },
                files={"file": (f"question.{extensions[media_type]}", data, media_type)},
            )
            response.raise_for_status()
            result = response.json()
        text = result.get("text", "").strip()
        if not text:
            raise HTTPException(422, "No speech was detected. Please try again.")
        if len(text) > 2000:
            raise HTTPException(422, "The spoken question is too long. Try a shorter question.")
        return {"text": text, "language_code": result.get("language_code")}
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("voice_transcription_failed error_type=%s", type(exc).__name__)
        raise HTTPException(502, failure(exc)) from exc


@router.post(
    "/meetings/{meeting_id}/messages/{message_id}/speech", dependencies=[Depends(local_request)]
)
def speak(meeting_id: str, message_id: str, db: Session = Depends(get_db)):
    message = db.get(Message, message_id)
    if not message or message.meeting_id != meeting_id or message.role != "assistant":
        raise HTTPException(404, "Assistant answer not found in this meeting.")
    auth = headers()
    if len(message.content) > 10000:
        raise HTTPException(422, "This answer is too long for voice playback.")
    try:
        with httpx.Client(timeout=90) as client:
            response = client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}",
                headers=auth,
                params={"output_format": "mp3_44100_128"},
                json={"text": message.content, "model_id": settings.elevenlabs_tts_model},
            )
            response.raise_for_status()
        if not response.headers.get("content-type", "").startswith("audio/"):
            raise ValueError("Expected an audio response")
        return Response(
            content=response.content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"}
        )
    except Exception as exc:
        log.warning("voice_playback_failed error_type=%s", type(exc).__name__)
        raise HTTPException(502, failure(exc)) from exc
