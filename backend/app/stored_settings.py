"""Persist Settings-dialog connections in the database so restarts keep them.

API keys are encrypted with Fernet (AES-128-CBC + HMAC-SHA256) before storage, so a
database export alone does not reveal them. The encryption key comes from
SETTINGS_ENCRYPTION_KEY or, by default, the git-ignored file .secrets/settings.key
(created on first use, mode 600). Development and production run from this folder and
share it, so both can read what the other saved.

Saved values take precedence over .env. Removing a key saves an empty value, so a key
in .env does not silently come back after a restart.
"""

import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from .db import StoredSetting, now

log = logging.getLogger(__name__)
KEY_FILE = Path(__file__).resolve().parents[2] / ".secrets" / "settings.key"
SECRETS = ("anthropic_api_key", "elevenlabs_api_key")
PLAIN = ("ai_mode", "elevenlabs_voice_id")


def _fernet() -> Fernet:
    configured = os.environ.get("SETTINGS_ENCRYPTION_KEY", "").strip()
    if configured:
        return Fernet(configured.encode())
    if not KEY_FILE.exists():
        KEY_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(Fernet.generate_key())
        log.info("settings_encryption_key_created path=%s", KEY_FILE)
    return Fernet(KEY_FILE.read_bytes().strip())


def save(db, **values: str) -> None:
    """Upsert settings. Secrets are encrypted; an empty string records a removal."""
    fernet = _fernet()
    for name, value in values.items():
        if name not in SECRETS + PLAIN:
            raise ValueError(f"Unknown setting {name}")
        stored = fernet.encrypt(value.encode()).decode() if name in SECRETS else value
        row = db.get(StoredSetting, name)
        if row:
            row.value, row.updated_at = stored, now()
        else:
            db.add(StoredSetting(name=name, value=stored))
    db.commit()


def fingerprint(db) -> tuple:
    return tuple(db.execute(select(func.count(), func.max(StoredSetting.updated_at))).one())


def apply(settings, db) -> tuple:
    """Copy saved values onto the shared settings object; returns the fingerprint."""
    rows = {row.name: row.value for row in db.scalars(select(StoredSetting))}
    fernet = _fernet() if any(name in rows for name in SECRETS) else None
    for name in SECRETS:
        if name not in rows:
            continue
        try:
            setattr(settings, name, SecretStr(fernet.decrypt(rows[name].encode()).decode()))
        except InvalidToken:
            # Different machine or replaced key file: keep .env values, ask to reconnect.
            log.warning("stored_setting_unreadable name=%s", name)
    if rows.get("elevenlabs_voice_id"):
        settings.elevenlabs_voice_id = rows["elevenlabs_voice_id"]
    mode = rows.get("ai_mode")
    if mode == "anthropic" and settings.anthropic_api_key.get_secret_value():
        settings.ai_mode = "anthropic"
    elif mode == "demo":
        settings.ai_mode = "demo"
    return fingerprint(db)


def load(settings, factory) -> tuple | None:
    """Startup/refresh helper that never takes the app down."""
    try:
        with factory() as db:
            return apply(settings, db)
    except SQLAlchemyError as exc:
        log.warning("stored_settings_unavailable error_type=%s", type(exc).__name__)
        return None


class Refresher:
    """Picks up changes saved by another process (dev ↔ production) within seconds."""

    def __init__(self, settings, factory):
        self.settings, self.factory, self.seen = settings, factory, None

    def check(self) -> None:
        try:
            with self.factory() as db:
                current = fingerprint(db)
                if current != self.seen:
                    self.seen = apply(self.settings, db)
        except SQLAlchemyError as exc:
            log.warning("stored_settings_refresh_failed error_type=%s", type(exc).__name__)
