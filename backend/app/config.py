from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
    database_url: str = "sqlite:///./meeting.db"
    ai_mode: Literal["demo", "openai", "anthropic"] = "demo"
    openai_api_key: SecretStr = SecretStr("")
    anthropic_api_key: SecretStr = SecretStr("")
    anthropic_model: str = "claude-haiku-4-5-20251001"
    llm_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    elevenlabs_api_key: SecretStr = SecretStr("")
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_tts_model: str = "eleven_multilingual_v2"
    elevenlabs_stt_model: str = "scribe_v2"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    max_upload_bytes: int = 250_000
    # Review hosting only (scripts/cloudflare-host.sh): shared login and built UI.
    app_user: str = "reviewer"
    app_password: SecretStr = SecretStr("")
    frontend_dist: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
