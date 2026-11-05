import json
from unittest.mock import patch

import httpx
import pytest

from app.ai import Provider
from app.config import Settings
from app.schemas import Answer
import app.main as main
import app.worker as worker


def test_anthropic_request_is_structured_and_parsed():
    def respond(request):
        body = json.loads(request.content)
        assert request.headers["x-api-key"] == "test-only"
        assert body["output_config"]["format"]["schema"]["additionalProperties"] is False
        assert body["model"] == "claude-haiku-4-5-20251001"
        assert "untrusted" in body["system"]
        return httpx.Response(
            200,
            json={
                "stop_reason": "end_turn",
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "text": "Sam owns the review.",
                                "source_ids": ["real"],
                                "insufficient_evidence": False,
                            }
                        ),
                    }
                ],
                "usage": {"input_tokens": 5, "output_tokens": 5},
            },
        )

    transport = httpx.MockTransport(respond)
    original = httpx.Client
    with patch(
        "app.ai.httpx.Client", side_effect=lambda **kwargs: original(transport=transport, **kwargs)
    ):
        provider = Provider(Settings(ai_mode="anthropic", anthropic_api_key="test-only"))
        assert provider.answer(
            "Who owns it?", [], [{"id": "real", "text": "Sam owns the review."}]
        ).source_ids == ["real"]


def test_anthropic_missing_key_fails_fast():
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        Provider(Settings(ai_mode="anthropic", anthropic_api_key=""))


def test_connect_requires_local_settings_header(client):
    assert client.post("/api/settings/anthropic", json={"api_key": "test-only"}).status_code == 403
    assert (
        client.post(
            "/api/settings/anthropic",
            headers={"X-Local-Settings": "1", "Origin": "https://untrusted.example"},
            json={"api_key": "test-only"},
        ).status_code
        == 403
    )


def test_connect_validates_key_and_never_returns_it(client, monkeypatch):
    class Fake:
        def __init__(self, settings):
            assert settings.anthropic_api_key.get_secret_value() == "test-only"

        def structured(self, *args):
            return Answer(text="Connected", source_ids=[], insufficient_evidence=True)

    monkeypatch.setattr(main, "settings", Settings(ai_mode="demo"))
    monkeypatch.setattr(main, "Provider", Fake)
    response = client.post(
        "/api/settings/anthropic", headers={"X-Local-Settings": "1"}, json={"api_key": "test-only"}
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "anthropic"
    assert "test-only" not in response.text
    assert main.settings.ai_mode == "anthropic"


def test_anthropic_ingests_and_answers_without_embedding_api(client, database, monkeypatch):
    class Fake:
        def __init__(self, settings):
            pass

        def structured(self, *args):
            pass

        def notes(self, sources):
            from app.schemas import Notes

            return Notes(
                summary=[{"text": "Security review assigned.", "source_ids": [sources[0]["id"]]}],
                decisions=[],
                actions=[],
                questions=[],
            )

        def rewrite(self, question, history):
            return "security review"

        def answer(self, question, history, sources):
            return Answer(
                text="Sam owns the security review.",
                source_ids=[sources[0]["id"]],
                insufficient_evidence=False,
            )

        def embed(self, texts):
            raise AssertionError("Anthropic must not call an embedding API")

    settings = Settings(ai_mode="anthropic", anthropic_api_key="test-only")
    monkeypatch.setattr(main, "settings", settings)
    monkeypatch.setattr(main, "Provider", Fake)
    monkeypatch.setattr(worker, "Provider", Fake)
    mid = client.post(
        "/api/meetings",
        files={"file": ("Review.txt", b"[00:00] Sam: I own the security review.", "text/plain")},
    ).json()["id"]
    worker.process_meeting(database, settings, mid)
    assert client.get(f"/api/meetings/{mid}").json()["status"] == "ready"
    response = client.post(f"/api/meetings/{mid}/messages", json={"text": "Who owns the review?"})
    assert response.status_code == 200
    assert response.json()["content"] == "Sam owns the security review."
    assert "Sam" in response.json()["citations"][0]["text"]


def test_settings_status_masks_keys_and_removal_returns_to_demo(client, monkeypatch):
    import app.voice as voice

    current = Settings(
        ai_mode="anthropic",
        anthropic_api_key="sk-ant-test-only-abcd",
        elevenlabs_api_key="xi-test-only-wxyz",
    )
    monkeypatch.setattr(main, "settings", current)
    monkeypatch.setattr(voice, "settings", current)
    local = {"X-Local-Settings": "1"}
    assert client.get("/api/settings").status_code == 403
    response = client.get("/api/settings", headers=local)
    assert response.json()["ai"] == {
        "mode": "anthropic",
        "model": "claude-haiku-4-5-20251001",
        "key_hint": "…abcd",
    }
    assert response.json()["voice"]["key_hint"] == "…wxyz"
    assert "test-only" not in response.text

    assert client.delete("/api/settings/anthropic").status_code == 403
    assert client.delete("/api/settings/anthropic", headers=local).json() == {"mode": "demo"}
    assert current.ai_mode == "demo" and not current.anthropic_api_key.get_secret_value()
    assert client.delete("/api/settings/elevenlabs", headers=local).json() == {"connected": False}
    assert not current.elevenlabs_api_key.get_secret_value()
