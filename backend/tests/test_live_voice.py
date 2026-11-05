import json
from unittest.mock import patch

import httpx
import pytest

import app.live_voice as live
from app import voice
from app.config import Settings
from app.db import Chunk, Meeting


@pytest.fixture(autouse=True)
def configure(monkeypatch):
    settings = Settings(elevenlabs_api_key="private-test-key")
    monkeypatch.setattr(live, "settings", settings)
    monkeypatch.setattr(voice, "settings", settings)
    live._agent_cache.clear()


def meeting(database, title="A", status="ready"):
    with database() as db:
        m = Meeting(title=title, status=status, mode="demo", turns=[])
        db.add(m)
        db.flush()
        db.add(Chunk(meeting_id=m.id, ordinal=0, text=f"{title}: Sam owns review", start=0, end=20))
        db.commit()
        return m.id


def mock_http(handler):
    original = httpx.Client
    return patch(
        "app.live_voice.httpx.Client",
        side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )


def test_session_private_reused_and_token_not_cached(client, database):
    mid = meeting(database)
    calls = []

    def respond(request):
        calls.append(request.url.path)
        if request.method == "POST":
            config = json.loads(request.content)
            assert config["platform_settings"]["auth"]["enable_auth"] is True
            assert "Sam owns" not in request.content.decode()
            assert config["conversation_config"]["agent"]["prompt"]["tools"][0]["expects_response"]
            return httpx.Response(200, json={"agent_id": "agent_test"})
        return httpx.Response(200, json={"token": "short-lived-token"})

    with mock_http(respond):
        for _ in range(2):
            response = client.post(
                f"/api/meetings/{mid}/voice/session", headers={"X-Local-Settings": "1"}
            )
            assert response.status_code == 200
            assert response.json() == {"token": "short-lived-token"}
            assert response.headers["cache-control"] == "no-store"
            assert "private-test-key" not in response.text
    assert calls.count("/v1/convai/agents/create") == 1
    assert calls.count("/v1/convai/conversation/token") == 2


def test_evidence_scoped_no_ai_key_required(client, database):
    a, b = meeting(database, "Alpha"), meeting(database, "PrivateBeta")
    response = client.post(
        f"/api/meetings/{a}/voice/evidence",
        headers={"X-Local-Settings": "1"},
        json={"text": "Who owns review?"},
    )
    assert response.status_code == 200
    assert response.json()["complete_transcript"]
    assert "Alpha" in response.text
    assert "PrivateBeta" not in response.text
    assert b not in response.text


def test_session_errors_sanitized(client, database):
    mid = meeting(database)
    with mock_http(lambda request: httpx.Response(403, text="private-test-key provider body")):
        response = client.post(
            f"/api/meetings/{mid}/voice/session", headers={"X-Local-Settings": "1"}
        )
    assert response.status_code == 502
    assert "Agents permissions" in response.json()["detail"]
    assert "private-test-key" not in response.text


def test_routes_guarded_and_meeting_ready(client, database):
    mid = meeting(database, status="processing")
    for suffix in ("session", "evidence"):
        route = f"/api/meetings/{mid}/voice/{suffix}"
        assert client.post(route, json={"text": "hi"}).status_code == 403
        assert (
            client.post(
                route,
                headers={"X-Local-Settings": "1", "Origin": "https://evil.example"},
                json={"text": "hi"},
            ).status_code
            == 403
        )
        assert (
            client.post(route, headers={"X-Local-Settings": "1"}, json={"text": "hi"}).status_code
            == 409
        )


def test_configuration_error_is_actionable_and_redacts_key(client, database):
    mid = meeting(database)
    with mock_http(
        lambda request: httpx.Response(
            400, json={"detail": {"message": "Invalid configuration private-test-key"}}
        )
    ):
        response = client.post(
            f"/api/meetings/{mid}/voice/session", headers={"X-Local-Settings": "1"}
        )
    assert response.status_code == 502
    assert "Invalid configuration" in response.text
    assert "private-test-key" not in response.text


def test_english_agent_uses_an_english_tts_model():
    from app.live_voice import agent_configuration

    config = agent_configuration()["conversation_config"]
    assert config["agent"]["language"] == "en"
    # ElevenLabs rejects English agents unless TTS is turbo or flash v2 (not *_v2_5).
    assert config["tts"]["model_id"] in ("eleven_flash_v2", "eleven_turbo_v2")
