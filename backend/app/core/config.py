from functools import lru_cache
from pathlib import Path
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
    staff_token_ttl_hours: int = 12
    # Столько есть на то, чтобы назвать имя после кода из SMS
    signup_token_ttl_minutes: int = 20

    default_tenant_id: str = "mamaroma"

    # Фотографии пока лежат на диске рядом с приложением. При переезде в облако
    # меняется только это место и функция сохранения — ссылки в базе относительные.
    media_root: Path = Path(__file__).resolve().parents[2] / "media"
    media_url_prefix: str = "/media"
    max_upload_bytes: int = 8 * 1024 * 1024
    image_max_side: int = 1400
    # 92 вместо 82: фотографии сайта уже пережаты один раз, второй проход
    # по еде заметен — подтираются текстуры
    image_quality: int = 92

    sms_code_length: int = 4
    sms_code_ttl_minutes: int = 5
    sms_code_resend_seconds: int = 60
    sms_code_max_attempts: int = 5
    # В local и staging код не отправляем, а пишем в лог и принимаем этот фиксированный
    sms_code_debug_value: str | None = "0000"

    cors_origins: list[str] = [
        "http://localhost:8081",
        "http://localhost:19006",
        "http://localhost:8000",
    ]

    # Вне продакшена разрешаем локальную сеть: телефон открывает приложение
    # по адресу вида http://192.168.0.5:8081, и это другой origin
    cors_local_network_regex: str = (
        r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|"
        r"172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?"
    )

    # Подсказки адресов. DaData знает российские дома вместе с корпусами и
    # строениями и отвечает за десятки миллисекунд; без токена откатываемся
    # на открытую карту OpenStreetMap — она медленная и знает не всё.
    dadata_token: str = ""
    # Секретный ключ нужен только стандартизации — она добирает метро и КАД.
    # На бесплатном тарифе её лимит 100 запросов в сутки против 10 000 у подсказок,
    # поэтому по умолчанию сохраняем адрес по подсказке, а стандартизацию держим
    # как запасной вариант. На платном тарифе достаточно поднять флаг.
    dadata_secret: str = ""
    dadata_clean_addresses: bool = False
    yandex_geocoder_key: str = ""

    sms_provider_api_key: str = ""
    yookassa_shop_id: str = ""
    yookassa_secret_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
