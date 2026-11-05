import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, ForeignKey, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import get_settings


def uid() -> str:
    return str(uuid.uuid4())


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[str] = mapped_column(default=now)
    status: Mapped[str] = mapped_column(default="processing")
    mode: Mapped[str] = mapped_column(default="demo")
    embedding_model: Mapped[str | None]
    error: Mapped[str | None] = mapped_column(Text)
    turns: Mapped[list] = mapped_column(JSON)
    notes: Mapped[dict | None] = mapped_column(JSON)
    chunks: Mapped[list["Chunk"]] = relationship(cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship(cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    ordinal: Mapped[int]
    start: Mapped[int]
    end: Mapped[int]
    text: Mapped[str] = mapped_column(Text)
    # JSON on SQLite enables offline tests; production uses pgvector cosine distance.
    embedding: Mapped[list | None] = mapped_column(JSON().with_variant(Vector(1536), "postgresql"))


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    meeting_id: Mapped[str] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[str] = mapped_column(default=now)
    role: Mapped[str]
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[list] = mapped_column(JSON, default=list)


class StoredSetting(Base):
    """Connection settings saved from the Settings dialog; secrets are encrypted."""

    __tablename__ = "app_settings"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(default=now)


def normalize_url(url: str) -> str:
    """Accept Supabase/Neon style postgres:// URLs; this project ships the psycopg 3 driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


def make_engine(url: str):
    url = normalize_url(url)
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 5})

        @event.listens_for(engine, "connect")
        def configure_sqlite(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            # WAL lets reads continue during a write (API requests + ingestion worker,
            # or dev and hosted processes on one file). Writers wait instead of failing.
            if ":memory:" not in url:
                connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA busy_timeout=5000")
            connection.execute("PRAGMA synchronous=NORMAL")

        return engine
    # Hosted Postgres (e.g. Supabase pooler) closes idle connections: check before use.
    # prepare_threshold=None keeps psycopg compatible with PgBouncer transaction pooling.
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=5,
        connect_args={"prepare_threshold": None, "connect_timeout": 10},
    )


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        yield session
