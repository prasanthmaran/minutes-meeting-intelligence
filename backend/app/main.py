import asyncio
import json
import logging
import time
import uuid
from urllib.parse import quote
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, UploadFile, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from .ai import Provider, provider_error
from .config import get_settings
from .db import Chunk, Meeting, Message, SessionLocal, engine, get_db, upgrade_sqlite
from .intelligence import demo_answer, retrieve, source, validate_sources
from .schemas import Question, Answer
from pydantic import BaseModel, SecretStr, Field
from .transcripts import parse_transcript
from .worker import Worker
from .hosting import configure_hosting
from . import stored_settings
from .voice import local_request, router as voice_router
from .live_voice import router as live_voice_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)
settings = get_settings()
TRANSCRIPT_TYPES = {"txt", "vtt", "srt"}


@asynccontextmanager
async def lifespan(app):
    if engine.dialect.name == "sqlite":
        upgrade_sqlite(engine)
    # Keys saved from Settings survive restarts (encrypted in the database).
    stored_settings.load(settings, SessionLocal)
    if settings.ai_mode != "demo":
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
app.include_router(voice_router)
app.include_router(live_voice_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Local-Settings"],
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
        "model": (
            settings.anthropic_model if settings.ai_mode == "anthropic" else settings.llm_model
        )
        if settings.ai_mode != "demo"
        else None,
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
        "progress": meeting.progress,
        "source_name": meeting.source_name,
    }


@app.get("/api/meetings")
def meetings(db: Session = Depends(get_db)):
    return [summary(m) for m in db.scalars(select(Meeting).order_by(Meeting.created_at.desc()))]


@app.post("/api/meetings", status_code=202)
def upload(file: UploadFile, db: Session = Depends(get_db)):
    extension = (file.filename or "").lower().rsplit(".", 1)[-1]
    if not file.filename or "." not in file.filename or extension not in TRANSCRIPT_TYPES:
        raise HTTPException(415, "Upload a UTF-8 transcript file (.txt, .vtt or .srt).")
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
        .rsplit("/", 1)[-1]
        .rsplit(".", 1)[0]
        .replace("_", " ")
        .replace("-", " ")
        .strip()[:160]
        or "Untitled meeting"
    )
    meeting = Meeting(
        title=title,
        turns=turns,
        status="queued",
        mode=settings.ai_mode,
        source_text=transcript,
        source_name=file.filename.replace("\\", "/").rsplit("/", 1)[-1][:255],
    )
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


@app.get("/api/meetings/{meeting_id}/events")
async def meeting_events(meeting_id: str, request: Request):
    """Server-Sent Events: processing progress until the meeting is ready or failed.

    Progress is read from the database because the worker may run in another process.
    Events: `progress` on every change, `done` once finished; comments keep proxies open.
    """
    open_db = request.app.dependency_overrides.get(get_db, get_db)

    def snapshot():
        sessions = open_db()
        db = next(sessions)
        try:
            meeting = db.get(Meeting, meeting_id)
            if not meeting:
                return None
            return {"status": meeting.status, "error": meeting.error, "progress": meeting.progress}
        finally:
            sessions.close()

    if await run_in_threadpool(snapshot) is None:
        raise HTTPException(404, "Meeting not found.")

    async def stream():
        last, quiet = None, 0.0
        deadline = time.monotonic() + 15 * 60
        yield "retry: 2000\n\n"
        while time.monotonic() < deadline and not await request.is_disconnected():
            state = await run_in_threadpool(snapshot)
            if state is None:
                yield 'event: done\ndata: {"status": "deleted"}\n\n'
                return
            data = json.dumps(state, separators=(",", ":"))
            if data != last:
                last, quiet = data, 0.0
                yield f"event: progress\ndata: {data}\n\n"
            elif quiet >= 15:
                quiet = 0.0
                yield ": keep-alive\n\n"
            if state["status"] in ("ready", "failed"):
                yield f"event: done\ndata: {data}\n\n"
                return
            await asyncio.sleep(0.5)
            quiet += 0.5

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.get("/api/meetings/{meeting_id}/source")
def meeting_source(meeting_id: str, download: bool = False, db: Session = Depends(get_db)):
    """The uploaded transcript exactly as received (UTF-8 text)."""
    meeting = get_meeting(db, meeting_id)
    if meeting.source_text is None:
        raise HTTPException(404, "The original file was not stored for this meeting.")
    name = meeting.source_name or f"{meeting.title}.txt"
    safe = (
        "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in name).strip()
        or "transcript.txt"
    )
    headers = {"Cache-Control": "no-store"}
    if download:
        headers["Content-Disposition"] = (
            f"attachment; filename=\"{safe}\"; filename*=UTF-8''{quote(name)}"
        )
    return PlainTextResponse(meeting.source_text, headers=headers)


@app.post("/api/meetings/{meeting_id}/retry", status_code=202)
def retry(meeting_id: str, db: Session = Depends(get_db)):
    meeting = get_meeting(db, meeting_id)
    if meeting.status not in ("failed", "ready"):
        raise HTTPException(409, "This meeting is already processing.")
    db.execute(delete(Chunk).where(Chunk.meeting_id == meeting_id))
    db.execute(delete(Message).where(Message.meeting_id == meeting_id))
    meeting.notes, meeting.error, meeting.status = None, None, "queued"
    meeting.progress = None
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
        provider = Provider(settings) if settings.ai_mode != "demo" else None
        query = provider.rewrite(question, history) if provider else question
        vector = provider.embed([query])[0] if settings.ai_mode == "openai" else None
        chunks = retrieve(db, meeting_id, query, vector)
        if settings.ai_mode == "anthropic":
            # Small meetings fit the context budget: retain the complete discussion so
            # generic questions and later corrections are not lost to keyword matching.
            all_chunks = list(
                db.scalars(
                    select(Chunk).where(Chunk.meeting_id == meeting_id).order_by(Chunk.ordinal)
                )
            )
            if sum(len(c.text) for c in all_chunks) <= 14000:
                chunks = all_chunks
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
        raise HTTPException(502, provider_error(exc)) from exc
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


class AIConnection(BaseModel):
    api_key: SecretStr = Field(exclude=True)


@app.post("/api/settings/anthropic")
def connect_anthropic(body: AIConnection, request: Request, db: Session = Depends(get_db)):
    # Local-development endpoint only: never enable this unprotected endpoint on a hosted app.
    if request.headers.get("X-Local-Settings") != "1":
        raise HTTPException(403, "Use the local AI settings dialog.")
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise HTTPException(403, "Unknown origin.")
    ensure_idle(db)
    key = body.api_key.get_secret_value().strip()
    if not key or len(key) > 500:
        raise HTTPException(422, "Enter a valid Anthropic API key.")
    candidate = settings.model_copy(
        update={"ai_mode": "anthropic", "anthropic_api_key": SecretStr(key)}
    )
    try:
        Provider(candidate).structured(
            Answer,
            "Connection check: return text='Connected', source_ids=[], insufficient_evidence=true.",
            {"check": "connection"},
        )
    except Exception as exc:
        log.warning("ai_connection_failed error_type=%s", type(exc).__name__)
        raise HTTPException(502, provider_error(exc)) from exc
    # Saved encrypted so restarts keep it; never returned to the browser.
    stored_settings.save(db, anthropic_api_key=key, ai_mode="anthropic")
    settings.anthropic_api_key = SecretStr(key)
    settings.ai_mode = "anthropic"
    return {"mode": "anthropic", "model": settings.anthropic_model}


def key_hint(secret: SecretStr) -> str | None:
    """Last four characters only, so the user can tell which key is active."""
    value = secret.get_secret_value()
    return f"…{value[-4:]}" if len(value) >= 12 else ("…" if value else None)


def ensure_idle(db: Session):
    if db.scalar(select(Meeting.id).where(Meeting.status.in_(["queued", "processing"])).limit(1)):
        raise HTTPException(
            409, "Wait for meeting processing to finish before changing AI settings."
        )


@app.get("/api/settings", dependencies=[Depends(local_request)])
def connection_settings():
    return {
        "ai": {
            "mode": settings.ai_mode,
            "model": settings.anthropic_model
            if settings.ai_mode == "anthropic"
            else settings.llm_model
            if settings.ai_mode == "openai"
            else None,
            "key_hint": key_hint(settings.anthropic_api_key)
            if settings.ai_mode == "anthropic"
            else key_hint(settings.openai_api_key)
            if settings.ai_mode == "openai"
            else None,
        },
        "voice": {
            "connected": bool(settings.elevenlabs_api_key.get_secret_value()),
            "key_hint": key_hint(settings.elevenlabs_api_key),
            "voice_id": settings.elevenlabs_voice_id,
        },
    }


@app.delete("/api/settings/anthropic", dependencies=[Depends(local_request)])
def disconnect_anthropic(db: Session = Depends(get_db)):
    ensure_idle(db)
    # Session-only removal: a key in .env is read again on the next backend restart.
    # An empty saved value records the removal, so a .env key does not return on restart.
    removal = {"anthropic_api_key": ""}
    if settings.ai_mode == "anthropic":
        removal["ai_mode"] = "demo"
    stored_settings.save(db, **removal)
    settings.anthropic_api_key = SecretStr("")
    if settings.ai_mode == "anthropic":
        settings.ai_mode = "demo"
    return {"mode": settings.ai_mode}


@app.delete("/api/settings/elevenlabs", dependencies=[Depends(local_request)])
def disconnect_elevenlabs(db: Session = Depends(get_db)):
    stored_settings.save(db, elevenlabs_api_key="")
    settings.elevenlabs_api_key = SecretStr("")
    return {"connected": False}


# Last, so the optional built frontend never shadows an /api route.
configure_hosting(app, settings)
