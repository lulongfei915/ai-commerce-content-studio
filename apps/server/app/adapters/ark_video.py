from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar

import httpx
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.shared.config import DEFAULT_ARK_VIDEO_MODEL, Settings

TASKS_PATH = "/contents/generations/tasks"
SAFE_IDENTIFIER = r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}"
TaskStatus = Literal["queued", "running", "succeeded", "failed", "cancelled", "expired"]
Body = TypeVar("Body", bound=BaseModel)


class VideoGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    model: str = Field(default=DEFAULT_ARK_VIDEO_MODEL, min_length=1)
    prompt: str = Field(min_length=1)
    duration: int = Field(default=5, ge=4, le=15, strict=True)
    ratio: Literal["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] = "16:9"
    resolution: Literal["480p", "720p", "1080p", "4K"] = "720p"
    watermark: bool = True
    generate_audio: bool = False

    def to_payload(self) -> dict[str, Any]:
        return {
            **self.model_dump(exclude={"prompt"}),
            "content": [{"type": "text", "text": self.prompt}],
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
