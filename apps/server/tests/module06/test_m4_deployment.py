import base64
import json
from datetime import datetime, timezone
from unittest.mock import Mock

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.adapters.ark_image import ArkImageClient
from app.modules.creation.models import CreationOutput
from app.modules.execution import runner, video_runner
from app.modules.execution.models import ImageStep
from app.shared.config import get_settings

from ..module05.test_canvas import API, create_draft, setup_task


def install_license(settings, monkeypatch, tmp_path, *, expiry="2099-01-01T00:00:00Z"):
    key = Ed25519PrivateKey.generate()
    public_key = tmp_path / "studio.pub"
    public_key.write_bytes(key.public_key().public_bytes_raw())
    data = json.dumps({
        "product": "studio", "installation_id": "site-a", "expires_at": expiry,
    }).encode()
    license_file = tmp_path / "license.json"
    license_file.write_text(json.dumps({
        "payload": base64.b64encode(data).decode(),
        "signature": base64.b64encode(key.sign(data)).decode(),
    }))
    for name, value in {
        "deployment_mode": "private",
        "installation_id": "site-a",
        "license_file": license_file,
        "license_public_key_file": public_key,
    }.items():
        monkeypatch.setitem(settings.__dict__, name, value)
    return license_file


def test_offline_license_binds_installation_and_rejects_invalid_signature(monkeypatch, tmp_path):
    from app.shared.entitlements import paid_call_block

    settings = get_settings()
    license_file = install_license(settings, monkeypatch, tmp_path)
    now = datetime(2026, 11, 26, tzinfo=timezone.utc)
    assert paid_call_block(settings, now=now) is None
    monkeypatch.setitem(settings.__dict__, "installation_id", "site-b")
    assert paid_call_block(settings, now=now) == "license_invalid"
    monkeypatch.setitem(settings.__dict__, "installation_id", "site-a")
    envelope = json.loads(license_file.read_text())
    envelope["signature"] = base64.b64encode(bytes(64)).decode()
    license_file.write_text(json.dumps(envelope))
    assert paid_call_block(settings, now=now) == "license_invalid"
    license_file.unlink()
    assert paid_call_block(settings, now=now) == "license_invalid"


@pytest.mark.parametrize("mode, detail, code", [
    ("expired", "license_expired", 402),
    ("recovery", "paid_calls_paused", 503),
])
def test_paid_gate_holds_unsent_outputs_but_keeps_existing_reads(
    client, db, monkeypatch, tmp_path, mode, detail, code,
):
    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_unlimited", True)
    monkeypatch.setattr(settings, "image_ceiling_cents", 5)
    path = f"{API}/creations/{draft['id']}"
    request = {"expected_version": draft["version"], "idempotency_key": "queued-before-gate"}
    queued = client.post(path + "/executions", headers=headers, json=request)
    assert queued.status_code == 202, queued.text
    original = queued.json()
    if mode == "expired":
        install_license(settings, monkeypatch, tmp_path, expiry="2000-01-01T00:00:00Z")
    else:
        monkeypatch.setitem(settings.__dict__, "paid_calls_paused", True)

    output = original["outputs"][0]["id"]
    send = Mock(side_effect=AssertionError("unexpected provider send"))
    monkeypatch.setattr(ArkImageClient, "generate", send)
    runner.process(db, output, None, settings)
    send.assert_not_called()
    assert db.get_one(CreationOutput, output).status == "queued"
    assert db.get_one(ImageStep, output).lease is None
    assert client.post(path + "/executions", headers=headers, json=request).json() == original
    rejected = client.post(path + "/executions", headers=headers, json={
        **request, "idempotency_key": "new-paid-call",
    })
    assert (rejected.status_code, rejected.json()) == (code, {"detail": detail})
    assistance = client.post(path + "/assistances", headers=headers, json={
        "expected_version": draft["version"], "kind": "optimize",
    })
    assert (assistance.status_code, assistance.json()) == (code, {"detail": detail})


def test_expired_license_still_polls_and_archives_video(client, db, monkeypatch, tmp_path):
    from types import SimpleNamespace

    from pydantic import SecretStr

    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product, purpose="video")
    settings = get_settings()
    monkeypatch.setattr(settings, "ark_api_key", SecretStr("test-key"))
    monkeypatch.setattr(settings, "video_budget_unlimited", True)
    queued = client.post(f"{API}/creations/{draft['id']}/executions", headers=headers, json={
        "expected_version": draft["version"], "idempotency_key": "sent-before-expiry",
    })
    assert queued.status_code == 202, queued.text
    identifier = queued.json()["outputs"][0]["id"]
    step = db.get_one(ImageStep, identifier)
    output = db.get_one(CreationOutput, identifier)
    step.provider_id, step.fee_state = "original-provider-task", "unverified"
    output.status = "generating"
    db.commit()
    install_license(settings, monkeypatch, tmp_path, expiry="2000-01-01T00:00:00Z")
    calls = []

    def poll(_, provider_id):
        calls.append(provider_id)
        return SimpleNamespace(status="succeeded", video_url="https://result.example/video.mp4")

    def archive(_, job, output, step, storage, settings, now):
        output.status = "pending_review"

    monkeypatch.setattr(video_runner.ArkVideoClient, "get_task", poll)
    monkeypatch.setattr(video_runner, "save_result", archive)
    runner.process(db, identifier, None, settings)
    assert (output.status, step.provider_id) == ("saving", "original-provider-task")
    runner.process(db, identifier, None, settings)
    assert output.status == "pending_review"
    assert calls == ["original-provider-task"]


def test_dispatch_orders_recovery_before_tenant_round_robin():
    from app.entrypoints.scheduler import dispatch_order

    rows = [
        ("a-saving", "alpha", "saving"),
        ("a1", "alpha", "queued"),
        ("a2", "alpha", "queued"),
        ("b1", "beta", "queued"),
        ("b2", "beta", "queued"),
        ("b-polling", "beta", "generating"),
    ]
    assert dispatch_order(rows) == ["a-saving", "b-polling", "a1", "b1", "a2", "b2"]
    assert dispatch_order(rows, after_tenant="alpha", queued_limit=2) == [
        "a-saving", "b-polling", "b1", "a1",
    ]
