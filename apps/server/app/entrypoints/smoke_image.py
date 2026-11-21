from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.adapters.ark_image import ArkImageClient, ArkImageError, ImageGenerationRequest
from app.shared.config import get_settings


def main() -> int:
    settings = get_settings()
    request = ImageGenerationRequest(
        model=settings.ark_image_model,
        prompt="米白色低帮运动鞋，干净浅灰影棚背景，商品主图，正方形构图",
        size="1K",
        output_format="png",
        background="opaque",
        response_format="url",
        watermark=True,
    )

    try:
        with ArkImageClient(settings) as client:
            response = client.generate(request)
            result = response.data[0]
            if result.url is None:
                raise ArkImageError(
                    "图片烟测响应未返回 URL",
                    category="invalid_response",
                    request_id=response.request_id,
                )
            output_path = _download_result(str(result.url))
    except ArkImageError as error:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "category": error.category,
                    "http_status": error.status_code,
                    "request_id": error.request_id,
                    "retry_after": error.retry_after,
                    "provider_code": error.provider_code,
                },
                ensure_ascii=False,
            )
        )
        return 2
    except httpx.HTTPError:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "category": "result_download_failed",
                    "request_id": response.request_id,
                },
                ensure_ascii=False,
            )
        )
        return 3

    print(
        json.dumps(
            {
                "status": "passed",
                "request_id": response.request_id,
                "result_count": len(response.data),
                "downloaded_bytes": output_path.stat().st_size,
                "output_format": result.output_format,
            },
            ensure_ascii=False,
        )
    )
    return 0


def _download_result(url: str) -> Path:
    output_dir = Path(".artifacts/ark-image-smoke")
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output_path = output_dir / f"{timestamp}.png"
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        response = client.get(url)
        response.raise_for_status()
        output_path.write_bytes(response.content)
    return output_path


if __name__ == "__main__":
    raise SystemExit(main())
