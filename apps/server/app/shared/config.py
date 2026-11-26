from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ARK_VIDEO_MODEL = "doubao-seedance-2-0-260128"


class Settings(BaseSettings):
    app_name: str = "studio-api"
    environment: str = "development"
    deployment_mode: Literal["saas", "private"] = "saas"
    installation_id: str = ""
    license_file: Path = Path("/run/studio-license/license.json")
    license_public_key_file: Path = Path("/run/studio-license/studio.pub")
    paid_calls_paused: bool = False
    api_prefix: str = "/api/v1"
    database_url: str = "mysql+pymysql://studio:studio@localhost:3306/studio"
    redis_url: str = "redis://localhost:6379/0"
    storage_endpoint: str = "http://localhost:9000"
    storage_signed_endpoint: str | None = None
    storage_bucket: str = "studio-private"
    storage_access_key: SecretStr | None = None
    storage_secret_key: SecretStr | None = None
    auth_public_origin: str | None = None
    auth_totp_key: SecretStr | None = None
    session_ttl_seconds: int = Field(default=28800, ge=60, le=86400)
    upload_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    max_image_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    max_video_bytes: int = Field(default=100 * 1024 * 1024, gt=0)
    log_level: str = "INFO"
    ark_api_key: SecretStr | None = None
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_image_model: str = "doubao-seedream-5-5-261028"
    ark_video_model: str = DEFAULT_ARK_VIDEO_MODEL
    ark_video_25_model: str = ""
    video_budget_cents: int = Field(default=0, ge=0)
    video_budget_unlimited: bool = False
    video_ceiling_cents: int = Field(default=0, ge=0)
    ark_timeout_seconds: float = 60.0
    itaiapi_api_key: SecretStr | None = None
    itaiapi_base_url: str = "https://xinapi.itaiapi.com/v1"
    itaiapi_image_models: str = "gpt-image-2"
    itaiapi_timeout_seconds: float = Field(default=240.0, gt=0)
    itaiapi_image_ceiling_cents: int | None = Field(default=None, ge=0)
    image_budget_cents: int = Field(default=0, ge=0)
    image_budget_unlimited: bool = False
    image_ceiling_cents: int = Field(default=0, ge=0)
    image_tenant_slots: int = Field(default=4, gt=0)
    image_provider_slots: int = Field(default=8, gt=0)
    ark_vision_model: str = ""
    assistance_ceiling_cents: int = Field(default=0, ge=0)

    model_config = SettingsConfigDict(
        env_file=(".env", "apps/server/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
