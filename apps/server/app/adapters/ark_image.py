from __future__ import annotations

import re
from typing import Any, Literal, cast

import httpx
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from app.shared.config import Settings

from .image_errors import ErrorCategory, ImageProviderError

IMAGE_GENERATION_PATH = "/images/generations"
DEFAULT_IMAGE_MODEL = "doubao-seedream-5-5-261028"
OutputFormat = Literal["png", "jpeg"]
Background = Literal["auto", "transparent", "opaque"]
ResponseFormat = Literal["url", "b64_json"]


class LayerDecompositionOptions(BaseModel):
    max_images: int = Field(default=30, ge=2, le=100)
    text_recognition: bool = False


class ImageGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = DEFAULT_IMAGE_MODEL
    prompt: str = Field(min_length=1, max_length=3000)
    image: str | list[str] | None = None
    size: str = "1K"
    output_format: OutputFormat = "png"
    background: Background = "opaque"
    response_format: ResponseFormat = "url"
    watermark: bool = True
    layer_decomposition: bool = False
    layer_decomposition_options: LayerDecompositionOptions | None = None

    @field_validator("size")
    @classmethod
    def validate_size(cls, value: str) -> str:
        if value in {"1K", "1.5K", "2K", "auto"}:
            return value
        match = re.fullmatch(r"(\d+)x(\d+)(?:x\d+(?:\.\d+)?)?", value)
        if match:
            width, height = (int(part) for part in match.groups()[:2])
            pixels = width * height
            ratio = width / height
            if 921_600 <= pixels <= 4_624_220 and 1 / 16 <= ratio <= 16:
                return value
        raise ValueError("size 必须是 1K、1.5K、2K、auto 或合法像素尺寸")

    @model_validator(mode="after")
    def validate_input_images(self) -> ImageGenerationRequest:
        if isinstance(self.image, list) and not 1 <= len(self.image) <= 10:
            raise ValueError("Seedream 5.5 最多支持 10 张参考图")
        if self.layer_decomposition and not self.image:
            raise ValueError("图层拆分必须提供 1 张参考图")
        if self.layer_decomposition and isinstance(self.image, list) and len(self.image) != 1:
            raise ValueError("图层拆分仅支持 1 张参考图")
        if self.output_format == "jpeg" and self.background == "transparent":
            raise ValueError("JPEG 不支持透明背景")
        if not self.layer_decomposition and self.layer_decomposition_options is not None:
            raise ValueError("layer_decomposition_options 仅在图层拆分时使用")
        if self.layer_decomposition and self.layer_decomposition_options is None:
            self.layer_decomposition_options = LayerDecompositionOptions()
        return self

    def to_payload(self) -> dict[str, Any]:
        payload = self.model_dump(exclude_none=True)
        if not self.layer_decomposition:
            payload.pop("layer_decomposition", None)
        if isinstance(self.image, list) and len(self.image) == 1:
            payload["image"] = self.image[0]
        return payload


class ImageGenerationItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    url: HttpUrl | None = None
    b64_json: str | None = None
    size: str | None = None
    output_format: str | None = None
    background: str | None = None


class ImageGenerationResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    data: list[ImageGenerationItem]
    request_id: str | None = None


class ArkImageError(ImageProviderError):
    pass


class ArkImageClient:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._client = httpx.Client(
            base_url=settings.ark_base_url.rstrip("/"),
            timeout=settings.ark_timeout_seconds,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> ArkImageClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        api_key = self._settings.ark_api_key
        if api_key is None or not api_key.get_secret_value().strip():
            raise ArkImageError(
                "未配置 ARK_API_KEY",
                category="configuration",
            )

        try:
            response = self._client.post(
                IMAGE_GENERATION_PATH,
                headers={
                    "Authorization": f"Bearer {api_key.get_secret_value()}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=request.to_payload(),
            )
        except httpx.TimeoutException as error:
            raise ArkImageError(
                "火山方舟图片请求超时，未自动重试付费请求",
                category="provider_timeout",
            ) from error
        except httpx.HTTPError as error:
            raise ArkImageError(
                "火山方舟图片请求失败",
                category="provider_unavailable",
            ) from error

        request_id = _request_id(response)
        if response.status_code >= 400:
            raise _build_provider_error(response, request_id)

        try:
            body = response.json()
            parsed = ImageGenerationResponse.model_validate(body)
        except (ValueError, TypeError) as error:
            raise ArkImageError(
                "火山方舟图片响应格式无效",
                category="invalid_response",
                status_code=response.status_code,
                request_id=request_id,
            ) from error

        request_id = request_id or parsed.request_id
        if not parsed.data:
            raise ArkImageError(
                "火山方舟图片响应未包含结果",
                category="invalid_response",
                status_code=response.status_code,
                request_id=request_id,
            )
        parsed.request_id = request_id
        return parsed


def _request_id(response: httpx.Response) -> str | None:
    request_id = response.headers.get("x-request-id") or response.headers.get("request-id")
    return cast(str | None, request_id)


def _build_provider_error(response: httpx.Response, request_id: str | None) -> ArkImageError:
    status = response.status_code
    category: ErrorCategory
    if status in {401, 403}:
        category = "authentication"
    elif status == 429:
        category = "rate_limited"
    elif status >= 500:
        category = "provider_unavailable"
    else:
        category = "invalid_request"

    retry_after = _retry_after(response) if status == 429 else None
    provider_code = _provider_code(response)
    message_by_category = {
        "authentication": "火山方舟图片鉴权失败，请检查 API Key 或模型开通状态",
        "rate_limited": "火山方舟图片请求被限流，已停止自动重试",
        "provider_unavailable": "火山方舟图片服务暂不可用",
        "invalid_request": "火山方舟图片请求未被接受，请检查模型和参数",
    }
    return ArkImageError(
        message_by_category[category],
        category=category,
        status_code=status,
        request_id=request_id,
        retry_after=retry_after,
        provider_code=provider_code,
    )


def _retry_after(response: httpx.Response) -> int | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return max(0, int(value))
    except ValueError:
        return None


def _provider_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if isinstance(error, dict) and isinstance(error.get("code"), str):
        return cast(str, error["code"])
    if isinstance(body.get("code"), str):
        return cast(str, body["code"])
    return None
