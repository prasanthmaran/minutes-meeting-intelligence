import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db, make_engine
from app.main import app


@pytest.fixture(autouse=True)
def settings_encryption_key(monkeypatch):
    # Tests never touch the real .secrets/settings.key.
    from cryptography.fernet import Fernet

    monkeypatch.setenv("SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())


@pytest.fixture
def database(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture
def client(database):
    def override():
        with database() as db:
            yield db

    app.dependency_overrides[get_db] = override
    # No lifespan: deterministic tests explicitly drive the worker.
    yield TestClient(app)
    app.dependency_overrides.clear()
