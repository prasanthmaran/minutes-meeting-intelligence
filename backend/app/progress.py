"""Processing progress saved on the meeting row, so any API process can stream it.

The worker and the streaming endpoint may run in different processes (development and
production share one database), so progress lives in the database, not in memory.
Writes are small, happen once per step or batch, and never hold a lock during
provider calls.
"""

from datetime import UTC, datetime

from .db import Meeting

# key, label, weight (share of the progress bar)
AI_STEPS = [
    ("read", "Reading the transcript", 4),
    ("evidence", "Preparing evidence passages", 8),
    ("notes", "Finding decisions and action items", 42),
    ("marks", "Marking questions and emotions", 30),
    ("speakers", "Summarizing each speaker", 12),
    ("save", "Saving results", 4),
]
DEMO_STEPS = [
    ("read", "Reading the transcript", 20),
    ("evidence", "Preparing evidence passages", 40),
    ("marks", "Marking questions", 25),
    ("save", "Saving results", 15),
]


def _now() -> str:
    return datetime.now(UTC).isoformat()


class Progress:
    def __init__(self, factory, meeting_id: str, ai: bool):
        self.factory, self.meeting_id = factory, meeting_id
        self.weights = {key: weight for key, _, weight in (AI_STEPS if ai else DEMO_STEPS)}
        self.state = {
            "steps": [
                {"key": key, "label": label, "state": "pending", "done": 0, "total": 0}
                for key, label, _ in (AI_STEPS if ai else DEMO_STEPS)
            ],
            "percent": 0,
            "detail": "Starting…",
            "started_at": _now(),
            "updated_at": _now(),
        }

    def _step(self, key):
        return next((s for s in self.state["steps"] if s["key"] == key), None)

    def _percent(self) -> int:
        total = sum(self.weights.values())
        earned = 0.0
        for step in self.state["steps"]:
            weight = self.weights[step["key"]]
            if step["state"] == "done":
                earned += weight
            elif step["state"] == "active" and step["total"]:
                earned += weight * step["done"] / step["total"]
        return min(99, round(earned / total * 100))

    def snapshot(self) -> dict:
        self.state["percent"] = self._percent()
        self.state["updated_at"] = _now()
        return dict(self.state)

    def _write(self) -> None:
        with self.factory() as db:
            meeting = db.get(Meeting, self.meeting_id)
            if meeting:
                meeting.progress = self.snapshot()
                db.commit()

    def start(self, key: str, total: int = 0, detail: str | None = None) -> None:
        step = self._step(key)
        if not step:
            return
        step.update(state="active", done=0, total=total)
        self.state["detail"] = detail or step["label"]
        self._write()

    def advance(self, key: str, detail: str | None = None) -> None:
        step = self._step(key)
        if not step:
            return
        step["done"] = min(step["done"] + 1, step["total"] or step["done"] + 1)
        if detail:
            self.state["detail"] = detail
        self._write()

    def finish(self, key: str, write: bool = True) -> None:
        step = self._step(key)
        if not step:
            return
        step.update(state="done", done=step["total"])
        if write:
            self._write()

    def fail(self) -> dict:
        for step in self.state["steps"]:
            if step["state"] == "active":
                step["state"] = "failed"
        self.state["detail"] = "Processing stopped"
        return self.snapshot()

    def complete(self) -> dict:
        for step in self.state["steps"]:
            step.update(state="done", done=step["total"])
        snapshot = self.snapshot()
        snapshot["percent"] = 100
        snapshot["detail"] = "Ready"
        return snapshot
