import hashlib
from io import BytesIO
from types import SimpleNamespace

import pytest


def test_object_archive_checks_content_before_writing_destination(tmp_path):
    from app.entrypoints.recovery import capture_objects, restore_objects

    data = b"archived result"

    class Storage:
        def __init__(self, objects):
            self.objects = objects

        def get_bucket_versioning(self, **kwargs):
            return {"Status": "Enabled"}

        def get_paginator(self, operation):
            assert operation == "list_objects_v2"
            return SimpleNamespace(paginate=lambda **_: [{
                "Contents": [{"Key": key} for key in self.objects],
            }])

        def get_object(self, *, Bucket, Key):
            return {
                "Body": BytesIO(self.objects[Key]), "VersionId": "previous-version",
                "ContentType": "image/png",
            }

        def upload_file(self, filename, bucket, key, ExtraArgs):
            from pathlib import Path

            assert ExtraArgs == {"ContentType": "image/png"}
            self.objects[key] = Path(filename).read_bytes()

    source = Storage({"private/example.png": data})
    target = Storage({})
    objects = capture_objects(source, "source", tmp_path)
    assert objects[0].sha256 == hashlib.sha256(data).hexdigest()
    assert objects[0].version == "previous-version"
    blob = next(tmp_path.iterdir())
    blob.write_bytes(b"damaged")
    with pytest.raises(ValueError, match="checksum"):
        restore_objects(target, "target", tmp_path, objects)
    assert target.objects == {}
    blob.write_bytes(data)
    restore_objects(target, "target", tmp_path, objects)
    assert target.objects == source.objects
    with pytest.raises(ValueError, match="empty"):
        restore_objects(target, "target", tmp_path, objects)
