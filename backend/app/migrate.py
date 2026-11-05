"""Prepare the configured database: Alembic migrations on PostgreSQL, tables on SQLite.

Run before starting the API:  uv run python -m app.migrate
"""

from pathlib import Path

from alembic.config import Config

from alembic import command

from .db import engine, upgrade_sqlite


def migrate() -> str:
    if engine.dialect.name == "sqlite":
        # Development SQLite files are created from the models (as on API startup).
        upgrade_sqlite(engine)
        return "sqlite: tables ready"
    root = Path(__file__).resolve().parent.parent
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(config, "head")
    return f"{engine.dialect.name}: migrations at head"


if __name__ == "__main__":
    print(migrate())
