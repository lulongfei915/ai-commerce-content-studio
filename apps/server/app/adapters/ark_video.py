from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar

import httpx
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from app.shared.config import DEFAULT_ARK_VIDEO_MODEL, Settings

TASKS_PATH = "/contents/generations/tasks"
SAFE_IDENTIFIER = r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}"
TaskStatus = Literal["queued", "running", "succeeded", "failed", "cancelled", "expired"]
Body = TypeVar("Body", bound=BaseModel)

VIDEO_DIMENSIONS = {
    "480p": ((854, 480), (752, 560), (640, 640), (992, 432)),
    "720p": ((1280, 720), (1112, 834), (960, 960), (1470, 630)),
    "1080p": ((1920, 1080), (1664, 1248), (1440, 1440), (2206, 946)),
    "4k": ((3840, 2160), (3326, 2494), (2880, 2880), (4398, 1886)),
}


def matches_video_dimensions(
    width: int, height: int, ratio: str, resolution: str, *, seedance_25: bool = False,
    frame_size: list[int] | None = None,
) -> bool:
    sizes = VIDEO_DIMENSIONS.get(resolution.lower())
    if not sizes or width <= 0 or height <= 0:
        return False
    if ratio == "adaptive":
        if not frame_size:
            return False
        frame_width, frame_height = frame_size
        square_side = sizes[2][0]
        return (
            abs(width / height / (frame_width / frame_height) - 1) <= 0.02
            and abs(width * height / square_side**2 - 1) <= 0.08
        )
    if resolution == "480p" and not seedance_25:
        sizes = ((864, 480), (736, 544), (640, 640), (960, 416))
    expected = dict(zip(("16:9", "4:3", "1:1", "21:9"), sizes, strict=True))
    expected["9:16"] = sizes[0][::-1]
    expected["3:4"] = sizes[1][::-1]
    return (width, height) == expected.get(ratio)


class VideoReference(BaseModel):
    role: Literal["first_frame", "last_frame", "reference_image", "reference_video"]
    url: str = Field(repr=False)


class VideoGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    model: str = Field(default=DEFAULT_ARK_VIDEO_MODEL, min_length=1)
    prompt: str = Field(min_length=1)
    duration: int = Field(default=5, ge=4, le=30, strict=True)
    ratio: Literal["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"] = "16:9"
    resolution: Literal["480p", "720p", "1080p", "4K", "4k"] = "720p"
    watermark: bool = True
    generate_audio: bool = False
    references: list[VideoReference] = Field(default_factory=list, repr=False)
    seedance_25: bool = Field(default=False, exclude=True)

    @model_validator(mode="after")
    def validate_model_range(self) -> VideoGenerationRequest:
        if not (self.seedance_25 or self.model.startswith("doubao-seedance-2-5-")) and (
            self.duration > 15 or self.ratio == "adaptive"
        ):
            raise ValueError("Seedance 2.0 only supports fixed ratios and 4–15 seconds")
        return self

    def to_payload(self) -> dict[str, Any]:
        content: list[dict[str, Any]] = [{"type": "text", "text": self.prompt}]
        for ref in self.references:
            kind = "video_url" if ref.role == "reference_video" else "image_url"
            content.append({"type": kind, kind: {"url": ref.url}, "role": ref.role})
        return {
            **self.model_dump(exclude={"prompt", "references"}),
            "content": content,
        }


class _CreatedTaskBody(BaseModel):
    id: str = Field(pattern=f"^{SAFE_IDENTIFIER}$")


class _TaskContent(BaseModel):
    video_url: HttpUrl | None = None


class _TaskUsage(BaseModel):
    total_tokens: int | None = None


class _TaskBody(_CreatedTaskBody):
    status: TaskStatus
    content: _TaskContent | None = None
    usage: _TaskUsage | None = None
    model: str | None = None


@dataclass(frozen=True)
class CreatedVideoTask:
    id: str
    http_status: int
    request_id: str | None


@dataclass(frozen=True)
class VideoTask:
    id: str
    status: TaskStatus
    request_id: str | None
    video_url: HttpUrl | None = field(repr=False)
    error_code: str | None = None
    total_tokens: int | None = None
    model: str | None = None


class ArkVideoError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        category: str,
        status_code: int | None = None,
        request_id: str | None = None,
        provider_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.status_code = status_code
        self.request_id = request_id
        self.provider_code = provider_code


class ArkVideoClient:
    def __init__(
        self, settings: Settings, *, transport: httpx.BaseTransport | None = None
    ) -> None:
        key = settings.ark_api_key
        self._key = key.get_secret_value().strip() if key else ""
        self._client = httpx.Client(
            base_url=settings.ark_base_url.rstrip("/"),
            timeout=settings.ark_timeout_seconds,
            transport=transport,
        )

    def __enter__(self) -> ArkVideoClient:
        return self

    def __exit__(self, *_: object) -> None:
        self._client.close()

    def create_task(self, request: VideoGenerationRequest) -> CreatedVideoTask:
        body, response = self._request("POST", TASKS_PATH, request.to_payload())
        task = self._parse(_CreatedTaskBody, body, response)
        if self._safe_id(task.id) is None:
            raise self._invalid_response("视频任务 ID 无效", response)
        return CreatedVideoTask(task.id, response.status_code, self._request_id(response))

    def get_task(self, task_id: str, *, timeout: float | None = None) -> VideoTask:
        if self._safe_id(task_id) is None:
            raise ArkVideoError("视频任务 ID 无效", category="invalid_request")
        body, response = self._request("GET", f"{TASKS_PATH}/{task_id}", timeout=timeout)
        task = self._parse(_TaskBody, body, response)
        if task.id != task_id:
            raise self._invalid_response("查询结果与任务 ID 不一致", response)
        url = task.content.video_url if task.content else None
        if task.status == "succeeded":
            if url is None:
                raise self._invalid_response("成功任务缺少视频 URL", response)
            if url.scheme != "https" or url.username is not None or url.password is not None:
                raise self._invalid_response("视频 URL 无效", response)
        return VideoTask(
            id=task.id,
            status=task.status,
            request_id=self._request_id(response),
            video_url=url,
            error_code=self._provider_code(body),
            total_tokens=task.usage.total_tokens if task.usage else None,
            model=self._safe_id(task.model),
        )

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> tuple[object, httpx.Response]:
        if not self._key:
            raise ArkVideoError("未配置 ARK_API_KEY", category="configuration")
        try:
            response = self._client.request(
                method,
                path,
                json=payload,
                headers={"Authorization": f"Bearer {self._key}", "Accept": "application/json"},
                timeout=self._client.timeout if timeout is None else timeout,
            )
        except httpx.TimeoutException:
            raise ArkVideoError("方舟视频请求超时", category="provider_timeout") from None
        except httpx.HTTPError:
            raise ArkVideoError("方舟视频请求失败", category="provider_unavailable") from None
        try:
            body: object = response.json()
        except ValueError:
            body = None
        if not response.is_success:
            status = response.status_code
            if status in {401, 403}:
                category = "authentication"
            elif status == 429:
                category = "rate_limited"
            elif status >= 500:
                category = "provider_unavailable"
            else:
                category = "invalid_request"
            raise ArkVideoError(
                "方舟视频请求未成功",
                category=category,
                status_code=status,
                request_id=self._request_id(response),
                provider_code=self._provider_code(body),
            )
        return body, response

    def _parse(self, schema: type[Body], body: object, response: httpx.Response) -> Body:
        try:
            return schema.model_validate(body)
        except ValueError:
            raise self._invalid_response("方舟视频响应格式无效", response) from None

    def _invalid_response(self, message: str, response: httpx.Response) -> ArkVideoError:
        return ArkVideoError(
            message,
            category="invalid_response",
            status_code=response.status_code,
            request_id=self._request_id(response),
        )

    def _request_id(self, response: httpx.Response) -> str | None:
        return self._safe_id(
            response.headers.get("x-request-id") or response.headers.get("request-id")
        )

    def _provider_code(self, body: object) -> str | None:
        if isinstance(body, dict):
            error = body.get("error")
            return self._safe_id(error.get("code") if isinstance(error, dict) else body.get("code"))
        return None

    def _safe_id(self, value: object) -> str | None:
        if isinstance(value, str) and re.fullmatch(SAFE_IDENTIFIER, value):
            if not self._key or self._key not in value:
                return value
        return None
