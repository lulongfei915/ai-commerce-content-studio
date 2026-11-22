from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from .domain import Permission, Role

TENANT_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$"


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_slug: str = Field(min_length=1, max_length=64, pattern=TENANT_PATTERN)
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+$")
    password: SecretStr = Field(min_length=1, max_length=256)
    otp: SecretStr | None = Field(default=None, min_length=6, max_length=6)

    @field_validator("tenant_slug", "email", mode="before")
    @classmethod
    def normalize(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class TenantInfo(BaseModel):
    id: str
    slug: str
    name: str


class CurrentSession(BaseModel):
    user_id: str
    email: str
    tenant: TenantInfo
    role: Role
    permissions: list[Permission]
    csrf_token: str
