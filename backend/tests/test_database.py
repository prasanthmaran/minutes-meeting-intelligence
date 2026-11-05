from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.copy_data import copy_data
from app.db import Base, Chunk, Meeting, Message, make_engine, normalize_url


def test_postgres_urls_use_installed_psycopg_driver():
    url = "postgresql://postgres.ref:pw@aws-0-x.pooler.supabase.com:5432/postgres"
    assert normalize_url(url).startswith("postgresql+psycopg://postgres.ref:pw@")
    assert normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("postgresql+psycopg://u@h/db") == "postgresql+psycopg://u@h/db"
    assert normalize_url("sqlite:///./meeting.db") == "sqlite:///./meeting.db"
    engine = make_engine(url)
    assert engine.dialect.name == "postgresql" and engine.dialect.driver == "psycopg"
    assert engine.pool._pre_ping


def test_copy_data_moves_rows_once(tmp_path):
    source_url = f"sqlite:///{tmp_path / 'source.db'}"
    source = make_engine(source_url)
    Base.metadata.create_all(source)
    with sessionmaker(source)() as db:
        meeting = Meeting(title="Launch", turns=[{"seconds": 0}], status="ready", mode="demo")
        stuck = Meeting(title="Stuck", turns=[{"seconds": 0}], status="processing", mode="demo")
        db.add_all([meeting, stuck])
        db.flush()
        db.add(Chunk(meeting_id=meeting.id, ordinal=0, start=0, end=0, text="Hi"))
        db.add(Message(meeting_id=meeting.id, role="user", content="Q", citations=[]))
        db.commit()
    source.dispose()

    target = make_engine(f"sqlite:///{tmp_path / 'target.db'}")
    Base.metadata.create_all(target)
    factory = sessionmaker(target, expire_on_commit=False)
    assert copy_data(source_url, factory) == {"meetings": 2, "chunks": 1, "messages": 1}
    assert copy_data(source_url, factory) == {"meetings": 0, "chunks": 0, "messages": 0}
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Meeting)) == 2
        assert db.scalar(select(Meeting.status).where(Meeting.title == "Stuck")) == "failed"
