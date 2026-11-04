from sqlalchemy import func, select

from app.config import Settings
from app.db import Chunk, Meeting, Message
from app.worker import process_meeting

TRANSCRIPT = "[00:00] Maya: Launch onboarding on November 12.\n[00:30] Sam: I own the security review by November 10."


def ingest(client, database, name="Launch.txt"):
    response = client.post(
        "/api/meetings", files={"file": (name, TRANSCRIPT.encode(), "text/plain")}
    )
    assert response.status_code == 202
    meeting_id = response.json()["id"]
    process_meeting(database, Settings(ai_mode="demo"), meeting_id)
    return meeting_id


def test_upload_search_citations_history_and_delete(client, database):
    meeting_id = ingest(client, database)
    detail = client.get(f"/api/meetings/{meeting_id}").json()
    assert detail["status"] == "ready"
    assert detail["speakers"] == ["Maya", "Sam"]
    answer = client.post(
        f"/api/meetings/{meeting_id}/messages", json={"text": "Who owns the security review?"}
    ).json()
    assert "Demo mode" in answer["content"]
    assert answer["citations"][0]["id"] in [s["id"] for s in detail["sources"]]
    assert "Sam" in answer["citations"][0]["text"]
    assert len(client.get(f"/api/meetings/{meeting_id}/messages").json()) == 2
    assert client.delete(f"/api/meetings/{meeting_id}").status_code == 204
    with database() as db:
        for model in (Meeting, Chunk, Message):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_unknown_topic_abstains(client, database):
    mid = ingest(client, database)
    response = client.post(
        f"/api/meetings/{mid}/messages", json={"text": "elephant migration population"}
    )
    assert response.status_code == 200
    assert response.json()["insufficient_evidence"]
    assert response.json()["citations"] == []


def test_meeting_isolation(client, database):
    first = ingest(client, database)
    other = client.post(
        "/api/meetings",
        files={"file": ("Other.txt", b"[00:00] Eve: Zebra habitat migration.", "text/plain")},
    ).json()["id"]
    process_meeting(database, Settings(ai_mode="demo"), other)
    answer = client.post(f"/api/meetings/{first}/messages", json={"text": "zebra habitat"})
    assert answer.json()["citations"] == []


def test_upload_validation_and_missing_meeting(client):
    assert client.post("/api/meetings", files={"file": ("a.pdf", b"hi")}).status_code == 415
    assert (
        client.post("/api/meetings", files={"file": ("a.txt", b"missing timestamps")}).status_code
        == 422
    )
    assert client.post("/api/meetings", files={"file": ("a.txt", b"x" * 250001)}).status_code == 413
    assert client.post("/api/meetings", files={"file": ("a.txt", b"\xff")}).status_code == 422
    assert client.get("/api/meetings/missing").status_code == 404


def test_queued_work_cannot_be_deleted_or_chatted(client):
    mid = client.post("/api/meetings", files={"file": ("a.txt", TRANSCRIPT.encode())}).json()["id"]
    assert client.delete(f"/api/meetings/{mid}").status_code == 409
    assert client.post(f"/api/meetings/{mid}/messages", json={"text": "Launch?"}).status_code == 409
    assert client.post(f"/api/meetings/{mid}/retry").status_code == 409


def test_retry_removes_stale_chunks_and_history(client, database):
    mid = ingest(client, database)
    client.post(f"/api/meetings/{mid}/messages", json={"text": "Launch?"})
    assert client.post(f"/api/meetings/{mid}/retry").status_code == 202
    assert client.get(f"/api/meetings/{mid}/messages").json() == []
    assert client.get(f"/api/meetings/{mid}").json()["sources"] == []
    process_meeting(database, Settings(ai_mode="demo"), mid)
    assert client.get(f"/api/meetings/{mid}").json()["status"] == "ready"


def test_failed_provider_does_not_silently_fall_back(client, database):
    mid = client.post("/api/meetings", files={"file": ("a.txt", TRANSCRIPT.encode())}).json()["id"]
    process_meeting(database, Settings(ai_mode="openai", openai_api_key=""), mid)
    assert client.get(f"/api/meetings/{mid}").json()["status"] == "failed"


def test_whitespace_question_rejected(client, database):
    mid = ingest(client, database)
    assert client.post(f"/api/meetings/{mid}/messages", json={"text": "  "}).status_code == 422
