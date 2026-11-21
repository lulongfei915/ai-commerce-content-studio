from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

import httpx

from app.adapters.ark_video import ArkVideoClient, ArkVideoError, VideoGenerationRequest, VideoTask
from app.shared.config import get_settings

POLL_SECONDS = 10
POLL_LIMIT_SECONDS = 1800
OUTPUT_DIR = Path(".artifacts/ark-video-smoke")
SMOKE_PROMPT = "米白色低帮运动鞋置于浅灰展台，柔和棚拍光，镜头缓慢横移展示鞋身和鞋底细节。"


def main() -> int:
    parser = argparse.ArgumentParser(description="方舟 Seedance 2.0 文生视频烟测")
    parser.add_argument("--task-id", help="继续查询已有烟测任务")
    args = parser.parse_args()
    task_id: str | None = args.task_id
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        _log("failed", category="ffprobe_missing")
        return 2

    settings = get_settings()
    try:
        with ArkVideoClient(settings) as client:
            if task_id is None:
                request = VideoGenerationRequest(
                    model=settings.ark_video_model, prompt=SMOKE_PROMPT
                )
                _log(
                    "submitting",
                    submitted_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    duration=request.duration,
                    ratio=request.ratio,
                    resolution=request.resolution,
                )
                created = client.create_task(request)
                task_id = created.id
                _log(
                    "submitted",
                    task_id=created.id,
                    http_status=created.http_status,
                    request_id=created.request_id,
                )
            result = _poll(client, task_id, settings.ark_timeout_seconds)
        if result.status != "succeeded" or result.video_url is None:
            _log(
                "failed",
                category="task_unsuccessful",
                task_id=result.id,
                final_status=result.status,
                request_id=result.request_id,
                provider_code=result.error_code,
            )
            return 2

        output, checked = _download_video(result, ffprobe)
    except ArkVideoError as error:
        _log(
            "failed",
            category=error.category,
            task_id=task_id,
            http_status=error.status_code,
            request_id=error.request_id,
            provider_code=error.provider_code,
        )
        return 2
    except (httpx.HTTPError, OSError):
        _log("failed", category="result_download_failed", task_id=task_id)
        return 3
    except (subprocess.SubprocessError, ValueError, TypeError, KeyError, IndexError):
        _log("failed", category="result_verification_failed", task_id=task_id)
        return 3
    except KeyboardInterrupt:
        _log("interrupted", task_id=task_id)
        return 130

    _log(
        "passed",
        task_id=result.id,
        model=result.model,
        final_status=result.status,
        request_id=result.request_id,
        total_tokens=result.total_tokens,
        output=str(output),
        **checked,
    )
    return 0


def _poll(client: ArkVideoClient, task_id: str, request_timeout: float) -> VideoTask:
    deadline = time.monotonic() + POLL_LIMIT_SECONDS
    last_status = None
    while (remaining := deadline - time.monotonic()) > 0:
        task = client.get_task(task_id, timeout=min(request_timeout, remaining))
        if task.status != last_status:
            _log(task.status, task_id=task.id, request_id=task.request_id)
            last_status = task.status
        if task.status not in {"queued", "running"}:
            return task
        time.sleep(min(POLL_SECONDS, max(0.0, deadline - time.monotonic())))
    raise ArkVideoError("等待任务超时，可使用原任务 ID 接续", category="poll_timeout")


def _download_video(task: VideoTask, ffprobe: str) -> tuple[Path, dict[str, object]]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / f"{task.id}.mp4"
    stream = NamedTemporaryFile(dir=OUTPUT_DIR, prefix=f"{task.id}-", suffix=".part", delete=False)
    temporary = Path(stream.name)
    try:
        with (
            stream,
            httpx.Client(timeout=60.0) as client,
            client.stream("GET", str(task.video_url)) as response,
        ):
            response.raise_for_status()
            for chunk in response.iter_bytes():
                stream.write(chunk)
        checked = _verify_video(ffprobe, temporary)
        checked["downloaded_bytes"] = temporary.stat().st_size
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return output, checked


def _verify_video(ffprobe: str, path: Path) -> dict[str, object]:
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "format=format_name,duration:format_tags=major_brand:stream=codec_name,width,height",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        check=True,
        timeout=30,
    )
    metadata = json.loads(result.stdout)
    container = metadata["format"]
    stream = metadata["streams"][0]
    duration = float(container["duration"])
    width, height = int(stream["width"]), int(stream["height"])
    if (
        "mp4" not in container["format_name"].split(",")
        or container.get("tags", {}).get("major_brand", "").strip() in {"", "qt"}
        or not 4.8 <= duration <= 5.2
        or (width, height) != (1280, 720)
    ):
        raise ValueError("MP4 文件与烟测规格不符")
    return {
        "format": "mp4",
        "codec": stream["codec_name"],
        "duration_seconds": duration,
        "width": width,
        "height": height,
    }


def _log(status: str, **fields: object) -> None:
    print(json.dumps({"status": status, **fields}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
