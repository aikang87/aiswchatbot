from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://aisw:aisw@localhost:5432/aisw"

    # Self-hosted LLM server (OpenAI-compatible)
    llm_base_url: str = "http://localhost:8001/v1"
    llm_model: str = "your-model-name"
    llm_api_key: str = "not-needed"

    # Embedding
    embedding_model: str = "BAAI/bge-m3"
    embedding_dim: int = 1024

    # Guardrail defaults (overridable per-domain in DB)
    scope_threshold: float = 0.35
    retrieval_threshold: float = 0.45

    # Admin auth
    admin_jwt_secret: str = "change-me-to-a-random-secret"
    admin_jwt_expire_minutes: int = 720

    # Anonymous session cookie
    session_cookie_name: str = "aisw_sid"
    session_cookie_secure: bool = False

    # App
    app_env: str = "development"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
