import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from .ai import Provider
from .config import get_settings
from .db import Base, Chunk, Meeting, Message, SessionLocal, engine, get_db
from .intelligence import demo_answer, retrieve, source, validate_sources
from .schemas import Question
from .transcripts import parse_transcript
from .worker import Worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app):
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)
    if settings.ai_mode == "openai":
        Provider(settings)  # fail fast on missing key; never silently switch providers
    with SessionLocal() as db:
        # MVP runs one API process. Interrupted work is explicitly retryable.
        db.execute(
            update(Meeting)
            .where(Meeting.status == "processing")
            .values(status="failed", error="Processing was interrupted. Please retry.")
        )
        db.commit()
    worker = Worker(SessionLocal, settings)
    worker.thread.start()
    yield
    worker.stop.set()
    worker.thread.join(timeout=2)


app = FastAPI(title="Minutes — Meeting Intelligence", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def request_logging(request, call_next):
    request_id, started = str(uuid.uuid4()), time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    log.info(
        "request id=%s method=%s status=%s latency_ms=%s",
        request_id,
        request.method,
        response.status_code,
        round((time.monotonic() - started) * 1000),
    )
    return response


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "mode": settings.ai_mode,
        "model": settings.llm_model if settings.ai_mode == "openai" else None,
    }


def get_meeting(db, meeting_id):
    meeting = db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(404, "Meeting not found.")
    return meeting


def summary(meeting):
    return {
        "id": meeting.id,
        "title": meeting.title,
        "created_at": meeting.created_at,
        "status": meeting.status,
        "mode": meeting.mode,
        "error": meeting.error,
        "speakers": list(dict.fromkeys(t["speaker"] for t in meeting.turns)),
        "duration": meeting.turns[-1]["seconds"],
        "turn_count": len(meeting.turns),
    }


@app.get("/api/meetings")
def meetings(db: Session = Depends(get_db)):
    return [summary(m) for m in db.scalars(select(Meeting).order_by(Meeting.created_at.desc()))]


@app.post("/api/meetings", status_code=202)
def upload(file: UploadFile, db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".txt"):
        raise HTTPException(415, "Upload a UTF-8 .txt transcript.")
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, "Transcript exceeds the 250 KB limit.")
    try:
        transcript = data.decode("utf-8-sig")
        if len(transcript) > 60_000:
            raise ValueError(
                "Transcript exceeds 60,000 characters. Split it into shorter meetings."
            )
        turns = parse_transcript(transcript)
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            422, str(exc) if not isinstance(exc, UnicodeDecodeError) else "Use UTF-8 text encoding."
        ) from exc
    title = (
        file.filename.replace("\\", "/")
        .rsplit("/", 1)[-1][:-4]
        .replace("_", " ")
        .replace("-", " ")
        .strip()[:160]
        or "Untitled meeting"
    )
    meeting = Meeting(title=title, turns=turns, status="queued", mode=settings.ai_mode)
    db.add(meeting)
    db.commit()
    return summary(meeting)


@app.get("/api/meetings/{meeting_id}")
def detail(meeting_id: str, db: Session = Depends(get_db)):
    meeting = get_meeting(db, meeting_id)
    return {
        **summary(meeting),
        "turns": meeting.turns,
        "notes": meeting.notes,
        "sources": [
            source(c)
            for c in db.scalars(
                select(Chunk).where(Chunk.meeting_id == meeting_id).order_by(Chunk.ordinal)
            )
        ],
    }


@app.post("/api/meetings/{meeting_id}/retry", status_code=202)
def retry(meeting_id: str, db: Session = Depends(get_db)):
    meeting = get_meeting(db, meeting_id)
    if meeting.status not in ("failed", "ready"):
        raise HTTPException(409, "This meeting is already processing.")
    db.execute(delete(Chunk).where(Chunk.meeting_id == meeting_id))
    db.execute(delete(Message).where(Message.meeting_id == meeting_id))
    meeting.notes, meeting.error, meeting.status = None, None, "queued"
    db.commit()
    return summary(meeting)


@app.delete("/api/meetings/{meeting_id}", status_code=204)
def remove(meeting_id: str, db: Session = Depends(get_db)):
    meeting = get_meeting(db, meeting_id)
    if meeting.status in ("queued", "processing"):
        raise HTTPException(409, "Wait until processing finishes before deleting.")
    db.delete(meeting)
    db.commit()


@app.get("/api/meetings/{meeting_id}/messages")
def messages(meeting_id: str, db: Session = Depends(get_db)):
    get_meeting(db, meeting_id)
    return [
        {"id": m.id, "role": m.role, "content": m.content, "citations": m.citations}
        for m in db.scalars(
            select(Message)
            .where(Message.meeting_id == meeting_id)
            .order_by(Message.created_at, Message.id)
        )
    ]


@app.post("/api/meetings/{meeting_id}/messages")
def chat(meeting_id: str, body: Question, db: Session = Depends(get_db)):
    meeting = get_meeting(db, meeting_id)
    if meeting.status != "ready":
        raise HTTPException(409, "The meeting is not ready yet.")
    question = body.text.strip()
    if not question:
        raise HTTPException(422, "Enter a question.")
    if meeting.mode != settings.ai_mode or (
        meeting.mode == "openai" and meeting.embedding_model != settings.embedding_model
    ):
        raise HTTPException(
            409, "AI configuration changed. Reprocess this meeting before asking questions."
        )
    recent = list(
        db.scalars(
            select(Message)
            .where(Message.meeting_id == meeting_id)
            .order_by(Message.created_at.desc())
            .limit(6)
        )
    )[::-1]
    history = [{"role": m.role, "content": m.content[:1600]} for m in recent]
    try:
        provider = Provider(settings) if settings.ai_mode == "openai" else None
        query = provider.rewrite(question, history) if provider else question
        vector = provider.embed([query])[0] if provider else None
        chunks = retrieve(db, meeting_id, query, vector)
        answer = (
            provider.answer(question, history, [source(c) for c in chunks])
            if provider
            else demo_answer(chunks)
        )
        if not answer.insufficient_evidence:
            validate_sources(answer.source_ids, {c.id for c in chunks})
        elif answer.source_ids:
            validate_sources(answer.source_ids, {c.id for c in chunks})
        citations = [source(c) for c in chunks if c.id in answer.source_ids]
    except Exception as exc:
        log.error("chat_failed meeting_id=%s error_type=%s", meeting_id, type(exc).__name__)
        raise HTTPException(
            502, "The AI service could not produce a validated answer. Please try again."
        ) from exc
    user_message = Message(meeting_id=meeting_id, role="user", content=question)
    assistant_message = Message(
        meeting_id=meeting_id, role="assistant", content=answer.text, citations=citations
    )
    db.add(user_message)
    db.flush()
    db.add(assistant_message)
    db.commit()
    return {
        "id": assistant_message.id,
        "role": "assistant",
        "content": answer.text,
        "citations": citations,
        "insufficient_evidence": answer.insufficient_evidence,
    }
