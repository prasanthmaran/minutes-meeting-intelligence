"""Copy meetings, chunks and messages from another database into the configured one.

    uv run python -m app.copy_data sqlite:///./meeting.db

Rows whose IDs already exist in the target are skipped, so it is safe to rerun.
"""

import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Chunk, Meeting, Message, SessionLocal, make_engine

COLUMNS = {
    Meeting: [c.key for c in Meeting.__table__.columns],
    Chunk: [c.key for c in Chunk.__table__.columns],
    Message: [c.key for c in Message.__table__.columns],
}


def copy_data(source_url: str, target_factory=SessionLocal) -> dict[str, int]:
    source_engine = make_engine(source_url)
    copied = {}
    try:
        with Session(source_engine) as source, target_factory() as target:
            for model in (Meeting, Chunk, Message):  # parents before children
                existing = set(target.scalars(select(model.id)))
                rows = [row for row in source.scalars(select(model)) if row.id not in existing]
                for row in rows:
                    values = {key: getattr(row, key) for key in COLUMNS[model]}
                    if model is Meeting and values["status"] in ("queued", "processing"):
                        values["status"], values["error"] = (
                            "failed",
                            "Copied mid-processing. Retry.",
                        )
                    target.add(model(**values))
                target.flush()
                copied[model.__tablename__] = len(rows)
            target.commit()
    finally:
        source_engine.dispose()
    return copied


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.copy_data <source-database-url>")
    print(copy_data(sys.argv[1]))
