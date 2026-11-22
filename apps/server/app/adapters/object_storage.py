from functools import lru_cache
from typing import BinaryIO, Protocol, cast

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.shared.config import Settings, get_settings


class StorageUnavailable(Exception):
    pass


class ObjectStorage(Protocol):
    def put(self, key: str, body: BinaryIO, content_type: str, size: int) -> None: ...
    def delete(self, key: str) -> None: ...
    def read(self, key: str, byte_range: tuple[int, int] | None) -> BinaryIO: ...


class S3Storage:
    def __init__(self, settings: Settings) -> None:
        if settings.storage_access_key is None or settings.storage_secret_key is None:
            raise StorageUnavailable
        self._bucket = settings.storage_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.storage_endpoint,
            region_name="us-east-1",
            aws_access_key_id=settings.storage_access_key.get_secret_value(),
            aws_secret_access_key=settings.storage_secret_key.get_secret_value(),
            config=Config(connect_timeout=5, read_timeout=20, s3={"addressing_style": "path"}),
        )

    def put(self, key: str, body: BinaryIO, content_type: str, size: int) -> None:
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=body,
                ContentLength=size,
                ContentType=content_type,
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable from exc

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable from exc

    def read(self, key: str, byte_range: tuple[int, int] | None) -> BinaryIO:
        try:
            options = (
                {} if byte_range is None else {"Range": f"bytes={byte_range[0]}-{byte_range[1]}"}
            )
            result = self._client.get_object(Bucket=self._bucket, Key=key, **options)
            return cast(BinaryIO, result["Body"])
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable from exc


@lru_cache(maxsize=1)
def get_object_storage() -> S3Storage:
    return S3Storage(get_settings())
