from functools import lru_cache
from typing import Literal

from pydantic import PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["local", "staging", "production"] = "local"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"
    project_name: str = "Mama Roma API"

    database_url: PostgresDsn = PostgresDsn(
        "postgresql+asyncpg://vladislav@localhost:5432/mamaroma_dev"
    )
    redis_url: RedisDsn = RedisDsn("redis://localhost:6379/0")

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 60

    default_tenant_id: str = "mamaroma"

    cors_origins: list[str] = ["http://localhost:8081", "http://localhost:19006"]

    sms_provider_api_key: str = ""
    yookassa_shop_id: str = ""
    yookassa_secret_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
