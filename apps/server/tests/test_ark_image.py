from __future__ import annotations

import json

import httpx
import pytest

from app.adapters.ark_image import (
    ArkImageClient,
    ArkImageError,
    ImageGenerationRequest,
)
from app.shared.config import Settings


def test_text_to_image_request_uses_seedream_defaults() -> None:
    request = ImageGenerationRequest(prompt="米白色运动鞋，干净棚拍背景")

    assert request.to_payload() == {
        "model": "doubao-seedream-5-5-261028",
        "prompt": "米白色运动鞋，干净棚拍背景",
        "size": "1K",
        "output_format": "png",
        "background": "opaque",
        "response_format": "url",
        "watermark": True,
    }


def test_reference_images_are_sent_as_a_list_without_leaking_api_key() -> None:
    request = ImageGenerationRequest(
        prompt="保留商品外观，替换为浅灰背景",
        image=[
            "https://example.com/product.png",
            "data:image/png;base64,ZmFrZQ==",
        ],
    )

    payload = request.to_payload()

    assert payload["image"] == [
        "https://example.com/product.png",
        "data:image/png;base64,ZmFrZQ==",
    ]
    assert "api_key" not in json.dumps(payload).lower()


def test_request_rejects_more_than_ten_reference_images() -> None:
    with pytest.raises(ValueError, match="最多支持 10 张"):
        ImageGenerationRequest(
            prompt="生成商品图",
            image=[f"https://example.com/{index}.png" for index in range(11)],
        )


def test_request_rejects_unsupported_size() -> None:
    with pytest.raises(ValueError, match="size"):
        ImageGenerationRequest(prompt="生成商品图", size="512x512")


def test_client_parses_url_response_and_request_id() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["json"] = json.loads(request.content)
        return httpx.Response(
            200,
            headers={"x-request-id": "req-image-123"},
            json={
                "data": [
                    {
                        "url": "https://example.com/generated.png",
                        "size": "1024x1024",
                        "output_format": "png",
                        "background": "opaque",
                    }
                ]
            },
        )

    client = ArkImageClient(
        Settings(_env_file=None, ark_api_key="secret-key"),
        transport=httpx.MockTransport(handler),
    )

    response = client.generate(ImageGenerationRequest(prompt="商品主图"))

    assert response.request_id == "req-image-123"
    assert str(response.data[0].url) == "https://example.com/generated.png"
    assert captured["headers"]["authorization"] == "Bearer secret-key"
    assert captured["json"]["model"] == "doubao-seedream-5-5-261028"


def test_client_classifies_rate_limit_without_retrying_or_exposing_response_body() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            429,
            headers={"retry-after": "12", "x-request-id": "req-limited"},
            text='{"message":"account secret should not be copied"}',
        )

    client = ArkImageClient(
        Settings(_env_file=None, ark_api_key="secret-key"),
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(ArkImageError) as error:
        client.generate(ImageGenerationRequest(prompt="商品主图"))

    assert calls == 1
    assert error.value.category == "rate_limited"
    assert error.value.retry_after == 12
    assert error.value.request_id == "req-limited"
    assert "account secret" not in str(error.value)


def test_client_requires_api_key() -> None:
    client = ArkImageClient(Settings(_env_file=None, ark_api_key=""))

    with pytest.raises(ArkImageError, match="ARK_API_KEY"):
        client.generate(ImageGenerationRequest(prompt="商品主图"))


def test_settings_loads_ark_api_key_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARK_API_KEY", "environment-key")

    settings = Settings(_env_file=None)

    assert settings.ark_api_key is not None
    assert settings.ark_api_key.get_secret_value() == "environment-key"
