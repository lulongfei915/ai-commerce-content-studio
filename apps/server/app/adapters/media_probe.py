import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError


class InvalidMedia(Exception):
    pass


class MediaUnavailable(Exception):
    pass


@dataclass(frozen=True)
class MediaInfo:
    width: int
    height: int
    duration_seconds: float | None = None


_IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def inspect_media(path: Path, content_type: str) -> MediaInfo:
    return (
        _image(path, content_type)
        if content_type.startswith("image/")
        else _video(path, content_type)
    )


def _image(path: Path, content_type: str) -> MediaInfo:
    try:
        with Image.open(path, formats=list(_IMAGE_TYPES)) as image:
            if _IMAGE_TYPES.get(image.format or "") != content_type:
                raise InvalidMedia("media_type_mismatch")
            if getattr(image, "n_frames", 1) != 1 or image.width * image.height > 25_000_000:
                raise InvalidMedia("unsupported_media_dimensions")
            image.verify()
        with Image.open(path, formats=list(_IMAGE_TYPES)) as image:
            image.load()
            return MediaInfo(image.width, image.height)
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise InvalidMedia("invalid_image") from exc


def _video(path: Path, content_type: str) -> MediaInfo:
    ffprobe, ffmpeg = shutil.which("ffprobe"), shutil.which("ffmpeg")
    if not ffprobe or not ffmpeg:
        raise MediaUnavailable
    # Accept only ordinary local MP4/MOV containers and disable external data references.
    input_options = [
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        "mov",
        "-enable_drefs",
        "0",
        "-probesize",
        "10000000",
        "-analyzeduration",
        "10000000",
    ]
    try:
        with path.open("rb") as body:
            marker = body.read(12)
        if marker[4:8] != b"ftyp":
            raise InvalidMedia("invalid_video")
        is_mov = marker[8:12] == b"qt  "
        if is_mov != (content_type == "video/quicktime"):
            raise InvalidMedia("media_type_mismatch")
        probe = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                *input_options,
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,avg_frame_rate:format=duration",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            timeout=10,
            check=True,
        )
        result = json.loads(probe.stdout)
        stream = result["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
        duration = float(result["format"]["duration"])
        numer, denom = map(int, stream["avg_frame_rate"].split("/"))
        if not (
            0 < width <= 4096
            and 0 < height <= 4096
            and 0 < duration <= 120
            and 0 < denom
            and 0 < (fps := numer / denom) <= 120
            and duration * fps <= 7200
        ):
            raise InvalidMedia("unsupported_video_dimensions_or_duration")
        subprocess.run(
            [
                ffmpeg,
                "-nostdin",
                "-v",
                "error",
                "-xerror",
                "-max_alloc",
                "134217728",
                *input_options,
                "-threads",
                "2",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-an",
                "-f",
                "null",
                "-",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=25,
            check=True,
        )
        return MediaInfo(width, height, duration)
    except subprocess.TimeoutExpired as exc:
        raise InvalidMedia("media_probe_timeout") from exc
    except (
        subprocess.CalledProcessError,
        OSError,
        ValueError,
        TypeError,
        KeyError,
        IndexError,
    ) as exc:
        raise InvalidMedia("invalid_video") from exc
