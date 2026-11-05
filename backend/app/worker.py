"""Single-process durable queue: queued rows survive restarts; work uses fresh sessions."""

import logging
import threading

from sqlalchemy import select, update

from .ai import Provider, provider_error
from .analysis import analyze
from .db import Chunk, Meeting, uid
from .intelligence import demo_notes, source, validate_notes
from .progress import Progress
from .schemas import Notes
from .stored_settings import Refresher
from .transcripts import chunk_turns

log = logging.getLogger(__name__)


def process_meeting(factory, settings, meeting_id: str):
    progress = None
    try:
        with factory() as db:
            meeting = db.get(Meeting, meeting_id)
            if not meeting:
                return
            turns = meeting.turns
        provider = Provider(settings) if settings.ai_mode != "demo" else None
        progress = Progress(factory, meeting_id, ai=provider is not None)
        speakers = len({t["speaker"] for t in turns})
        progress.start("read", detail=f"Reading {len(turns)} turns from {speakers} speakers")
        progress.finish("read", write=False)
        # Provider calls must not hold a database write lock.
        chunks = [Chunk(id=uid(), meeting_id=meeting_id, **chunk) for chunk in chunk_turns(turns)]
        progress.start("evidence", detail=f"Preparing {len(chunks)} evidence passages")
        if settings.ai_mode == "openai":
            embeddings = []
            for offset in range(0, len(chunks), 16):
                embeddings.extend(provider.embed([c.text for c in chunks[offset : offset + 16]]))
            for chunk, embedding in zip(chunks, embeddings, strict=True):
                chunk.embedding = embedding
        progress.finish("evidence", write=False)
        notes = demo_notes()
        if provider:
            # Bounded map extraction. No silent truncation of the end of long meetings.
            batches = range(0, len(chunks), 6)
            progress.start("notes", total=len(batches), detail="Finding decisions and action items")
            for number, offset in enumerate(batches, 1):
                batch = chunks[offset : offset + 6]
                result: Notes = provider.notes([source(c) for c in batch])
                validate_notes(result, {c.id for c in batch})
                for key, items in result.model_dump().items():
                    notes[key].extend(items)
                progress.advance(
                    "notes", detail=f"Read section {number} of {len(batches)} for decisions"
                )
            for key in notes:
                unique = {}
                for item in notes[key]:
                    unique.setdefault(item["text"].strip().lower(), item)
                notes[key] = list(unique.values())
            progress.finish("notes", write=False)
        # Transcript tab: per-turn markers/emotions and per-speaker summaries.
        notes.update(analyze(provider, turns, progress))
        progress.start("save", detail="Saving results")
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
            meeting.progress = progress.complete()
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
                if progress:
                    meeting.progress = progress.fail()
                db.commit()


class Worker:
    def __init__(self, factory, settings):
        self.factory, self.settings = factory, settings
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True, name="meeting-ingestion")
        # Keys saved in another process (dev or production) apply here within ~3 s.
        self.refresher = Refresher(settings, factory)
        self.ticks = 0

    def run(self):
        while not self.stop.is_set():
            if self.ticks % 3 == 0:
                self.refresher.check()
            self.ticks += 1
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
