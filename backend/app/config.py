from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
    database_url: str = "sqlite:///./meeting.db"
    ai_mode: Literal["demo", "openai"] = "demo"
    openai_api_key: SecretStr = SecretStr("")
    llm_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    max_upload_bytes: int = 250_000


@lru_cache
def get_settings() -> Settings:
    return Settings()
