"""Exercise AI-mode orchestration with a deterministic provider double, without paid calls."""

from app.config import Settings
from app.schemas import Answer, Notes
from app.worker import process_meeting
import app.main as main
import app.worker as worker


class FakeProvider:
    rewritten = []

    def __init__(self, settings):
        pass

    def embed(self, texts):
        return [[1.0] + [0.0] * 1535 for _ in texts]

    def notes(self, sources):
        return Notes(
            summary=[{"text": "Launch discussed.", "source_ids": [sources[0]["id"]]}],
            decisions=[],
            actions=[],
            questions=[],
        )

    def rewrite(self, question, history):
        self.rewritten.append(history)
        return "security review"

    def answer(self, question, history, sources):
        return Answer(
            text="Sam owns the security review.",
            source_ids=[sources[0]["id"]],
            insufficient_evidence=False,
        )


def setup_ai(client, database, monkeypatch):
    settings = Settings(ai_mode="openai", openai_api_key="test-not-a-real-key")
    monkeypatch.setattr(worker, "Provider", FakeProvider)
    monkeypatch.setattr(main, "Provider", FakeProvider)
    monkeypatch.setattr(main, "settings", settings)
    mid = client.post(
        "/api/meetings", files={"file": ("Test.txt", b"[00:00] Sam: I own the security review.")}
    ).json()["id"]
    process_meeting(database, settings, mid)
    return mid


def test_ai_ingestion_chat_and_followup_context(client, database, monkeypatch):
    FakeProvider.rewritten = []
    mid = setup_ai(client, database, monkeypatch)
    detail = client.get(f"/api/meetings/{mid}").json()
    assert detail["notes"]["summary"][0]["source_ids"][0] == detail["sources"][0]["id"]
    for question in ["Who owns the security review?", "When is it due?"]:
        response = client.post(f"/api/meetings/{mid}/messages", json={"text": question})
        assert response.status_code == 200
    assert len(FakeProvider.rewritten[-1]) == 2


def test_invalid_model_citation_rejected_and_not_saved(client, database, monkeypatch):
    mid = setup_ai(client, database, monkeypatch)
    monkeypatch.setattr(
        FakeProvider,
        "answer",
        lambda *args: Answer(
            text="Invented answer", source_ids=["fake"], insufficient_evidence=False
        ),
    )
    assert client.post(f"/api/meetings/{mid}/messages", json={"text": "Who?"}).status_code == 502
    assert client.get(f"/api/meetings/{mid}/messages").json() == []


def test_embedding_model_change_requires_reprocessing(client, database, monkeypatch):
    mid = setup_ai(client, database, monkeypatch)
    monkeypatch.setattr(main, "settings", Settings(ai_mode="openai", embedding_model="changed"))
    assert client.post(f"/api/meetings/{mid}/messages", json={"text": "Who?"}).status_code == 409


def test_invalid_extraction_rolls_back_chunks(client, database, monkeypatch):
    monkeypatch.setattr(
        FakeProvider,
        "notes",
        lambda *args: Notes(
            summary=[{"text": "Unsupported", "source_ids": ["fake"]}],
            decisions=[],
            actions=[],
            questions=[],
        ),
    )
    mid = setup_ai(client, database, monkeypatch)
    detail = client.get(f"/api/meetings/{mid}").json()
    assert detail["status"] == "failed"
    assert detail["sources"] == []
