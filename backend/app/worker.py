"""Single-process durable queue: queued rows survive restarts; work uses fresh sessions."""

import logging
import threading

from sqlalchemy import select, update

from .ai import Provider, provider_error
from .db import Chunk, Meeting, uid
from .intelligence import demo_notes, source, validate_notes
from .schemas import Notes
from .transcripts import chunk_turns

log = logging.getLogger(__name__)


def process_meeting(factory, settings, meeting_id: str):
    try:
        with factory() as db:
            meeting = db.get(Meeting, meeting_id)
            if not meeting:
                return
            turns = meeting.turns
        # Provider calls must not hold a database write lock.
        chunks = [Chunk(id=uid(), meeting_id=meeting_id, **chunk) for chunk in chunk_turns(turns)]
        provider = Provider(settings) if settings.ai_mode != "demo" else None
        if settings.ai_mode == "openai":
            embeddings = []
            for offset in range(0, len(chunks), 16):
                embeddings.extend(provider.embed([c.text for c in chunks[offset : offset + 16]]))
            for chunk, embedding in zip(chunks, embeddings, strict=True):
                chunk.embedding = embedding
        notes = demo_notes()
        if provider:
            # Bounded map extraction. No silent truncation of the end of long meetings.
            for offset in range(0, len(chunks), 6):
                batch = chunks[offset : offset + 6]
                result: Notes = provider.notes([source(c) for c in batch])
                validate_notes(result, {c.id for c in batch})
                for key, items in result.model_dump().items():
                    notes[key].extend(items)
            for key in notes:
                unique = {}
                for item in notes[key]:
                    unique.setdefault(item["text"].strip().lower(), item)
                notes[key] = list(unique.values())
        with factory() as db:
            meeting = db.get(Meeting, meeting_id)
            if not meeting:
                return
            db.add_all(chunks)
            meeting.notes = notes
            meeting.mode = settings.ai_mode
            meeting.embedding_model = (
                settings.embedding_model if settings.ai_mode == "openai" else None
            )
            meeting.status = "ready"
            meeting.error = None
            db.commit()
            log.info(
                "ingestion_complete meeting_id=%s chunks=%s mode=%s",
                meeting_id,
                len(chunks),
                settings.ai_mode,
            )
    except Exception as exc:
        # Never log provider exception text: it may contain uploaded content.
        log.error("ingestion_failed meeting_id=%s error_type=%s", meeting_id, type(exc).__name__)
        with factory() as db:
            meeting = db.get(Meeting, meeting_id)
            if meeting:
                meeting.status = "failed"
                meeting.error = provider_error(exc)
                db.commit()


class Worker:
    def __init__(self, factory, settings):
        self.factory, self.settings = factory, settings
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True, name="meeting-ingestion")

    def run(self):
        while not self.stop.is_set():
            try:
                with self.factory() as db:
                    meeting_id = db.scalar(
                        select(Meeting.id)
                        .where(Meeting.status == "queued")
                        .order_by(Meeting.created_at)
                        .limit(1)
                    )
                    if meeting_id:
                        claimed = db.execute(
                            update(Meeting)
                            .where(Meeting.id == meeting_id, Meeting.status == "queued")
                            .values(status="processing")
                        )
                        db.commit()
                        if claimed.rowcount:
                            process_meeting(self.factory, self.settings, meeting_id)
            except Exception as exc:
                log.error("worker_error error_type=%s", type(exc).__name__)
            self.stop.wait(1)
