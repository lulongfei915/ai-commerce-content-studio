"""Render reproducible, labeled development media for the two pilot categories."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def render(category: str, defect: str, index: int) -> Image.Image:
    photo = Image.new("RGB", (1024, 1024), (245 - index % 8, 245, 242))
    pen = ImageDraw.Draw(photo)
    color = "#265eab" if defect != "color" else "#d54337"
    dx = (index % 5 - 2) * 8
    if category == "apparel":
        outline = [
            (210, 580),
            (235, 505),
            (420, 495),
            (465, 370),
            (530, 365),
            (575, 470),
            (740, 535),
            (800, 562),
            (800, 612),
            (210, 612),
        ]
        if defect == "structure":
            outline[3] = (440, 245)
            outline[4] = (560, 245)
        pen.polygon([(x + dx, y) for x, y in outline], fill=color)
        pen.rounded_rectangle((205 + dx, 594, 805 + dx, 630), radius=14, fill="#383c3e")
        x, y = 390 + dx, 530
    else:
        pen.rounded_rectangle((360 + dx, 315, 660 + dx, 770), radius=40, fill=color)
        pen.rectangle((415 + dx, 235, 605 + dx, 335), fill="#363b3d")
        if defect == "structure":
            pen.rectangle((430 + dx, 205, 685 + dx, 245), fill="#363b3d")
        x, y = 450 + dx, 520
    pen.text(
        (x, y),
        "SKU B" if defect == "label" else "SKU A",
        fill="white",
        font=ImageFont.load_default(size=30),
    )
    if defect == "people_scene":
        pen.ellipse((735, 140, 817, 222), fill="#705e50")
        pen.polygon([(775, 218), (710, 410), (840, 410)], fill="#394c45")
    return photo


def build(directory: Path, duration: int = 2) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    records = []
    for category in ("apparel", "beauty"):
        reference = directory / f"{category}-ref.png"
        render(category, "valid", 0).save(reference)
        defects = ["color", "structure", "label", "people_scene"]
        for index in range(20):
            video = index >= 15
            defect = "valid" if index < 5 else defects[(index - 5) % len(defects)]
            identifier = f"{category}-{index:02d}"
            path = directory / (identifier + (".mp4" if video else ".png"))
            photo = render(category, defect, index)
            if video:
                # The discrepancy appears halfway through the clip.
                clean = render(category, "valid", index)
                frame_count = duration * 3
                midpoint = frame_count // 2
                frames = clean.tobytes() * midpoint + photo.tobytes() * (frame_count - midpoint)
                subprocess.run(
                    [
                        "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-f",
                        "rawvideo",
                        "-pix_fmt",
                        "rgb24",
                        "-video_size",
                        "1024x1024",
                        "-framerate",
                        "3",
                        "-i",
                        "pipe:0",
                        "-vf",
                        "scale=480:480,pad=854:480:(ow-iw)/2:(oh-ih)/2",
                        "-an",
                        "-c:v",
                        "libx264",
                        "-threads",
                        "1",
                        "-pix_fmt",
                        "yuv420p",
                        str(path),
                    ],
                    input=frames,
                    check=True,
                )
            else:
                photo.save(path)
            records.append(
                {
                    "id": identifier,
                    "category": category,
                    "file": path.name,
                    "reference": reference.name,
                    "media": "video" if video else "image",
                    "expected": "pending_review" if defect == "valid" else "blocked",
                    "problem": defect,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            )
    (directory / "manifest.json").write_text(json.dumps(records, indent=2) + "\n")
    print(
        f"{len(records)} labeled synthetic samples: 30 images, 10 videos, 10 valid images"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--duration", type=int, choices=(2, 5), default=2)
    args = parser.parse_args()
    build(args.output, args.duration)
