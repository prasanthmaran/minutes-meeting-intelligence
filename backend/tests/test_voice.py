from unittest.mock import patch

import httpx
import pytest

from app.config import Settings
from app.db import Meeting, Message
import app.voice as voice


@pytest.fixture(autouse=True)
def voice_settings(monkeypatch):
    monkeypatch.setattr(
        voice, "settings", Settings(ai_mode="anthropic", elevenlabs_api_key="test-only")
    )


def intercept(handler):
    original = httpx.Client
    return patch(
        "app.voice.httpx.Client",
        side_effect=lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )


def ready_meeting(database):
    with database() as db:
        meeting = Meeting(
            title="Voice test",
            turns=[{"id": 0, "seconds": 0, "speaker": "Sam", "text": "I own the review."}],
            status="ready",
            mode="anthropic",
        )
        db.add(meeting)
        db.flush()
        answer = Message(
            meeting_id=meeting.id, role="assistant", content="Sam owns the review.", citations=[]
        )
        db.add(answer)
        db.commit()
        return meeting.id, answer.id


def test_status_never_exposes_key(client):
    response = client.get("/api/voice/status")
    assert response.json()["connected"] is True
    assert "test-only" not in response.text


def test_connection_validates_voice_access_and_masks_key(client):
    with intercept(
        lambda request: httpx.Response(
            200, json={"voices": [{"voice_id": "safeVoice123", "name": "Test voice"}]}
        )
    ):
        response = client.post(
            "/api/settings/elevenlabs",
            headers={"X-Local-Settings": "1"},
            json={"api_key": "replacement-test"},
        )
    assert response.status_code == 200
    assert response.json()["voice_id"] == "safeVoice123"
    assert "replacement-test" not in response.text


def test_bad_key_returns_actionable_error_without_provider_body(client):
    with intercept(lambda request: httpx.Response(401, json={"detail": "PRIVATE PROVIDER BODY"})):
        response = client.post(
            "/api/settings/elevenlabs",
            headers={"X-Local-Settings": "1"},
            json={"api_key": "replacement-test"},
        )
    assert response.status_code == 502
    assert "rejected" in response.json()["detail"]
    assert "PRIVATE" not in response.text


def test_voice_posts_require_local_header_and_trusted_origin(client):
    assert client.post("/api/settings/elevenlabs", json={"api_key": "test"}).status_code == 403
    assert (
        client.post(
            "/api/settings/elevenlabs",
            headers={"X-Local-Settings": "1", "Origin": "https://untrusted.example"},
            json={"api_key": "test"},
        ).status_code
        == 403
    )


def test_transcription_sends_audio_to_elevenlabs_and_returns_question(client, database):
    mid, _ = ready_meeting(database)

    def respond(request):
        assert request.url.path == "/v1/speech-to-text"
        assert request.headers["xi-api-key"] == "test-only"
        assert b"scribe_v2" in request.content
        assert b"audio-data" in request.content
        return httpx.Response(200, json={"text": "Who owns the review?", "language_code": "en"})

    with intercept(respond):
        response = client.post(
            f"/api/meetings/{mid}/voice/transcribe",
            headers={"X-Local-Settings": "1"},
            files={"file": ("recording.webm", b"audio-data", "audio/webm;codecs=opus")},
        )
    assert response.status_code == 200
    assert response.json() == {"text": "Who owns the review?", "language_code": "en"}


def test_speech_is_scoped_to_an_existing_assistant_answer(client, database):
    mid, answer_id = ready_meeting(database)

    def respond(request):
        import json

        assert json.loads(request.content)["text"] == "Sam owns the review."
        assert json.loads(request.content)["model_id"] == "eleven_multilingual_v2"
        return httpx.Response(200, content=b"fake-mp3", headers={"Content-Type": "audio/mpeg"})

    with intercept(respond):
        response = client.post(
            f"/api/meetings/{mid}/messages/{answer_id}/speech", headers={"X-Local-Settings": "1"}
        )
    assert response.status_code == 200
    assert response.content == b"fake-mp3"
    assert response.headers["cache-control"] == "no-store"
    assert (
        client.post(
            f"/api/meetings/other/messages/{answer_id}/speech", headers={"X-Local-Settings": "1"}
        ).status_code
        == 404
    )


def test_audio_limits_missing_connection_and_demo_mode(client, database, monkeypatch):
    mid, _ = ready_meeting(database)
    route = f"/api/meetings/{mid}/voice/transcribe"
    h = {"X-Local-Settings": "1"}
    assert (
        client.post(
            route, headers=h, files={"file": ("file.txt", b"wrong", "text/plain")}
        ).status_code
        == 415
    )
    assert (
        client.post(
            route, headers=h, files={"file": ("file.webm", b"x" * 5_000_001, "audio/webm")}
        ).status_code
        == 413
    )
    assert (
        client.post(route, headers=h, files={"file": ("file.webm", b"", "audio/webm")}).status_code
        == 422
    )
    monkeypatch.setattr(voice, "settings", Settings(ai_mode="demo"))
    assert (
        client.post(
            route, headers=h, files={"file": ("file.webm", b"audio", "audio/webm")}
        ).status_code
        == 409
    )
