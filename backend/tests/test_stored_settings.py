from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select

from app import main, stored_settings, voice
from app.config import Settings
from app.db import StoredSetting
from app.schemas import Answer

LOCAL = {"X-Local-Settings": "1"}


class FakeProvider:
    def __init__(self, settings):
        pass

    def structured(self, *args):
        return Answer(text="Connected", source_ids=[], insufficient_evidence=True)


def test_keys_are_encrypted_and_survive_a_restart(client, database, monkeypatch):
    live = Settings(ai_mode="demo")
    monkeypatch.setattr(main, "settings", live)
    monkeypatch.setattr(voice, "settings", live)
    monkeypatch.setattr(main, "Provider", FakeProvider)
    key = "sk-ant-test-only-persisted-1234"
    assert (
        client.post("/api/settings/anthropic", headers=LOCAL, json={"api_key": key}).status_code
        == 200
    )

    with database() as db:
        row = db.get(StoredSetting, "anthropic_api_key")
        assert row and key not in row.value  # encrypted at rest
        assert db.get(StoredSetting, "ai_mode").value == "anthropic"

    restarted = Settings(ai_mode="demo")  # a fresh process with nothing in .env
    stored_settings.load(restarted, database)
    assert restarted.ai_mode == "anthropic"
    assert restarted.anthropic_api_key.get_secret_value() == key


def test_removal_is_remembered_over_env_keys(client, database, monkeypatch):
    live = Settings(ai_mode="anthropic", anthropic_api_key="sk-ant-from-env-0000")
    monkeypatch.setattr(main, "settings", live)
    monkeypatch.setattr(voice, "settings", live)
    assert client.delete("/api/settings/anthropic", headers=LOCAL).json() == {"mode": "demo"}

    restarted = Settings(ai_mode="anthropic", anthropic_api_key="sk-ant-from-env-0000")
    stored_settings.load(restarted, database)
    assert restarted.ai_mode == "demo"
    assert restarted.anthropic_api_key.get_secret_value() == ""


def test_other_process_changes_are_picked_up(database):
    with database() as db:
        stored_settings.save(db, elevenlabs_api_key="xi-test-only", elevenlabs_voice_id="v1")
    other = Settings()
    refresher = stored_settings.Refresher(other, database)
    refresher.check()
    assert other.elevenlabs_api_key.get_secret_value() == "xi-test-only"
    assert other.elevenlabs_voice_id == "v1"

    with database() as db:
        stored_settings.save(db, elevenlabs_api_key="")
    refresher.check()
    assert other.elevenlabs_api_key.get_secret_value() == ""


def test_unreadable_values_keep_env_settings(database, monkeypatch):
    with database() as db:
        stored_settings.save(db, anthropic_api_key="sk-ant-old-key", ai_mode="anthropic")
    monkeypatch.setenv("SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())  # key lost
    restarted = Settings(ai_mode="demo", anthropic_api_key=SecretStr(""))
    stored_settings.load(restarted, database)
    assert restarted.ai_mode == "demo"  # no usable key, so AI stays off instead of failing
    with database() as db:
        assert db.scalars(select(StoredSetting.name)).all()
