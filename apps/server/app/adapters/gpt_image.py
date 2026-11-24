from __future__ import annotations

import base64
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.shared.config import Settings

from .image_errors import ErrorCategory, ImageProviderError

IMAGE_MIME_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


@dataclass(frozen=True)
class GptImageResult:
    body: bytes
    request_id: str | None


class GptImageClient:
    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None):
        self._limit = settings.max_image_bytes
        key = settings.itaiapi_api_key
        token = key.get_secret_value().strip() if key else ""
        url = urlsplit(settings.itaiapi_base_url)
        if (
            not token or not token.isascii() or not token.isprintable()
            or any(char.isspace() for char in token)
            or url.scheme != "https" or not url.hostname or url.username is not None
            or url.query or url.fragment or not url.path.rstrip("/").endswith("/v1")
        ):
            raise ImageProviderError("GPT Image 服务端配置无效", category="configuration")
        self._client = httpx.Client(
            base_url=settings.itaiapi_base_url.rstrip("/") + "/",
            timeout=httpx.Timeout(settings.itaiapi_timeout_seconds, connect=15),
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            transport=transport,
        )

    def __enter__(self) -> GptImageClient:
        return self

    def __exit__(self, *_: object) -> None:
        self._client.close()

    def generate(
        self, model: str, prompt: str, size: str, quality: str,
        references: list[tuple[str, bytes]],
    ) -> GptImageResult:
        fields = {
            "model": model, "prompt": prompt, "size": size, "quality": quality,
            "output_format": "png", "n": 1,
        }
        try:
            if references:
                field = "image" if len(references) == 1 else "image[]"
                files = [
                    (field, (f"reference-{index}.{IMAGE_MIME_EXTENSIONS[mime]}", body, mime))
                    for index, (mime, body) in enumerate(references, start=1)
                ]
                response = self._client.post("images/edits", data=fields, files=files)
            else:
                response = self._client.post("images/generations", json=fields)
        except httpx.TimeoutException as exc:
            raise ImageProviderError("GPT Image 请求超时", category="provider_timeout") from exc
        except httpx.HTTPError as exc:
            raise ImageProviderError("GPT Image 请求失败", category="provider_unavailable") from exc
        request_id = (
            response.headers.get("x-request-id") or response.headers.get("x-oneapi-request-id")
            or response.headers.get("request-id")
        )
        if not response.is_success:
            raise _response_error(response, request_id)

        try:
            data = response.json()["data"]
            if not isinstance(data, list) or len(data) != 1:
                raise ValueError
            encoded = data[0]["b64_json"]
            encoded_limit = 4 * ((self._limit + 2) // 3)
            if not isinstance(encoded, str) or not encoded or len(encoded) > encoded_limit:
                raise ValueError
            body = base64.b64decode(encoded, validate=True)
            if len(body) > self._limit:
                raise ValueError
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            raise ImageProviderError(
                "GPT Image 响应没有可用的图片数据", category="invalid_response",
                status_code=response.status_code, request_id=request_id,
            ) from exc
        return GptImageResult(body, request_id)


def _response_error(response: httpx.Response, request_id: str | None) -> ImageProviderError:
    status = response.status_code
    category: ErrorCategory
    retry_after = None
    if status in (401, 403):
        category = "authentication"
    elif status == 429:
        category = "rate_limited"
        value = response.headers.get("retry-after", "")
        if value.isascii() and value.isdecimal() and len(value) <= 10:
            retry_after = int(value)
    elif status >= 500 or status == 408 or status < 400:
        category = "provider_unavailable"
    else:
        category = "invalid_request"
    return ImageProviderError(
        "GPT Image 请求未完成", category=category, status_code=status,
        request_id=request_id, retry_after=retry_after,
    )
