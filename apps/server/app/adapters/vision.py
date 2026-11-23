import base64
import json
from typing import Any

import httpx

from app.shared.config import Settings


def data_url(mime: str, body: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(body).decode('ascii')}"


def suggest(
    settings: Settings, instruction: str, context: dict[str, Any], images: list[str]
) -> tuple[str, str, dict[str, Any]]:
    if not settings.ark_api_key or not settings.ark_vision_model:
        raise ValueError("vision_unconfigured")
    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(context, ensure_ascii=False)}
    ]
    content.extend({"type": "image_url", "image_url": {"url": image}} for image in images)
    response = httpx.post(
        f"{settings.ark_base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {settings.ark_api_key.get_secret_value()}"},
        json={
            "model": settings.ark_vision_model,
            "messages": [
                {"role": "system", "content": instruction},
                {"role": "user", "content": content},
            ],
            "max_tokens": 1500,
        },
        timeout=settings.ark_timeout_seconds,
    )
    response.raise_for_status()
    result = response.json()
    text = result["choices"][0]["message"]["content"]
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty_response")
    return (
        text.strip(),
        str(response.headers.get("x-request-id") or result["id"]),
        result.get("usage", {}),
    )
