from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MediaType = Literal["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"]


class UploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=240)
    content_type: MediaType
    size_bytes: int = Field(gt=0, strict=True)

    @field_validator("filename")
    @classmethod
    def filename_only(cls, value: str) -> str:
        name = value.strip()
        if not name or name in {".", ".."} or any(c in "/\\" or not c.isprintable() for c in name):
            raise ValueError("invalid filename")
        return name


class UploadReservation(BaseModel):
    id: str
    status: Literal["pending"] = "pending"
    version: int = 1
    upload_path: str
    expires_at: datetime


class MediaFile(BaseModel):
    id: str
    filename: str
    content_type: str
    size_bytes: int
    status: Literal["ready"] = "ready"
    version: int
    width: int
    height: int
    duration_seconds: float | None
