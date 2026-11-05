import json

from app.config import Settings
from app.db import Meeting
from app.progress import Progress
from app.worker import process_meeting

TURNS = [
    {"id": 0, "seconds": 0, "speaker": "Maya", "text": "Can we ship?"},
    {"id": 1, "seconds": 9, "speaker": "Leo", "text": "Yes, Thursday."},
]


def add_meeting(database, status="queued", progress=None):
    with database() as db:
        meeting = Meeting(title="T", turns=TURNS, status=status, mode="demo", progress=progress)
        db.add(meeting)
        db.commit()
        return meeting.id


def test_progress_weights_steps_and_batches(database):
    meeting_id = add_meeting(database)
    progress = Progress(database, meeting_id, ai=True)
    progress.start("read")
    progress.finish("read", write=False)
    progress.start("evidence")
    progress.finish("evidence", write=False)
    progress.start("notes", total=2)
    progress.advance("notes", detail="Read section 1 of 2")
    with database() as db:
        saved = db.get(Meeting, meeting_id).progress
    assert saved["percent"] == 33  # read 4 + evidence 8 + half of notes 42 = 33 of 100
    assert saved["detail"] == "Read section 1 of 2"
    states = {s["key"]: s["state"] for s in saved["steps"]}
    assert states == {
        "read": "done",
        "evidence": "done",
        "notes": "active",
        "marks": "pending",
        "speakers": "pending",
        "save": "pending",
    }
    assert progress.complete()["percent"] == 100


def test_worker_records_progress_through_completion(database):
    meeting_id = add_meeting(database)
    process_meeting(database, Settings(ai_mode="demo"), meeting_id)
    with database() as db:
        meeting = db.get(Meeting, meeting_id)
        assert meeting.status == "ready"
        assert meeting.progress["percent"] == 100
        assert {s["state"] for s in meeting.progress["steps"]} == {"done"}
        assert [s["key"] for s in meeting.progress["steps"]] == [
            "read",
            "evidence",
            "marks",
            "save",
        ]


def test_events_stream_progress_then_done(client, database):
    meeting_id = add_meeting(database, status="ready", progress={"percent": 100, "steps": []})
    with client.stream("GET", f"/api/meetings/{meeting_id}/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join(response.iter_text())
    events = [block for block in body.split("\n\n") if block.startswith("event:")]
    assert [e.split("\n")[0] for e in events] == ["event: progress", "event: done"]
    assert json.loads(events[-1].split("data: ", 1)[1])["status"] == "ready"


def test_events_for_unknown_meeting_is_404(client):
    assert client.get("/api/meetings/missing/events").status_code == 404
