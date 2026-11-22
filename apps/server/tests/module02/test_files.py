from dataclasses import dataclass
from io import BytesIO
from typing import BinaryIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

from .conftest import login


@dataclass
class MemoryStorage:
    objects: dict[str, bytes]

    def put(self, key: str, body: BinaryIO, content_type: str, size: int) -> None:
        self.objects[key] = body.read()

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def read(self, key: str, byte_range: tuple[int, int] | None) -> BinaryIO:
        payload = self.objects[key]
        if byte_range is not None:
            start, end = byte_range
            payload = payload[start : end + 1]
        return BytesIO(payload)


@pytest.fixture
def picture() -> bytes:
    stream = BytesIO()
    Image.new("RGB", (32, 20), color="yellow").save(stream, format="PNG")
    return stream.getvalue()


@pytest.fixture
def media(client: TestClient) -> TestClient:
    try:
        from app.modules.assets.routes import get_storage
    except ModuleNotFoundError:
        return client
    storage = MemoryStorage({})
    app.dependency_overrides[get_storage] = lambda: storage
    return client


def reserve(client: TestClient, token: str, size: int) -> str:
    response = client.post(
        "/api/v1/files/uploads",
        json={
            "filename": "鞋子.png",
            "size_bytes": size,
            "content_type": "image/png",
        },
        headers={"X-CSRF-Token": token},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def upload(client: TestClient, file_id: str, token: str, data: bytes) -> int:
    return client.put(
        f"/api/v1/files/{file_id}/upload",
        content=data,
        headers={
            "X-CSRF-Token": token,
            "Content-Type": "image/png",
        },
    ).status_code


def test_private_file_validation_range_and_revoked_download(
    media: TestClient, picture: bytes
) -> None:
    token = login(media, "dina")
    file_id = reserve(media, token, len(picture))
    assert upload(media, file_id, token, picture) == 204
    assert upload(media, file_id, token, picture) == 409
    complete = media.post(f"/api/v1/files/{file_id}/complete", headers={"X-CSRF-Token": token})
    assert complete.status_code == 200
    assert complete.json()["width"] == 32 and complete.json()["height"] == 20
    assert (
        media.post(
            f"/api/v1/files/{file_id}/complete",
            headers={
                "X-CSRF-Token": token,
            },
        ).json()
        == complete.json()
    )
    path = f"/api/v1/files/{file_id}/content"
    result = media.get(path, headers={"Range": "bytes=2-9"})
    assert result.status_code == 206 and result.content == picture[2:10]
    assert result.headers["Content-Range"] == f"bytes 2-9/{len(picture)}"
    assert media.get(path, headers={"Range": "bytes=0-1,3-4"}).status_code == 416
    assert media.get(path, headers={"Range": "bytes=-4"}).content == picture[-4:]
    login(media, "denied")
    assert media.get(f"/api/v1/files/{file_id}").status_code == 200
    assert media.get(path, headers={"Range": "bytes=10-"}).status_code == 403
    login(media, "bob", "beta")
    assert media.get(path, headers={"Range": "bytes=10-"}).status_code == 404
    assert (
        media.post(
            f"/api/v1/files/{file_id}/complete",
            headers={
                "X-CSRF-Token": login(media, "bob", "beta"),
            },
        ).status_code
        == 404
    )


def test_bad_media_and_upload_limit_keep_file_unavailable(media: TestClient) -> None:
    token = login(media)
    assert (
        media.post(
            "/api/v1/files/uploads",
            json={
                "filename": "x.png",
                "size_bytes": 21 * 1024 * 1024,
                "content_type": "image/png",
            },
            headers={"X-CSRF-Token": token},
        ).status_code
        == 413
    )
    file_id = reserve(media, token, 12)
    assert upload(media, file_id, token, b"not an image") == 415
    assert (
        media.post(
            f"/api/v1/files/{file_id}/complete",
            headers={
                "X-CSRF-Token": token,
            },
        ).status_code
        == 409
    )
    assert media.get(f"/api/v1/files/{file_id}/content").status_code == 404


def test_viewer_cannot_upload_and_writes_require_csrf(media: TestClient, picture: bytes) -> None:
    token = login(media, "vern")
    data = {"filename": "x.png", "size_bytes": len(picture), "content_type": "image/png"}
    assert media.post("/api/v1/files/uploads", json=data).status_code == 403
    assert (
        media.post(
            "/api/v1/files/uploads",
            json=data,
            headers={
                "X-CSRF-Token": token,
            },
        ).status_code
        == 403
    )
