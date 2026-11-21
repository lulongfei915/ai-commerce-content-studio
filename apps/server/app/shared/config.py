from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "studio-api"
    environment: str = "development"
    api_prefix: str = "/api/v1"
    database_url: str = "mysql+pymysql://studio:studio@localhost:3306/studio"
    redis_url: str = "redis://localhost:6379/0"
    storage_endpoint: str = "http://localhost:9000"
    storage_bucket: str = "studio-private"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=(".env", "apps/server/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
