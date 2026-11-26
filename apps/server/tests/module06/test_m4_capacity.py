"""Opt-in API capacity baseline. Run with STUDIO_TEST_IMAGE_DATABASE on a scratch schema."""

import math
import os
from time import perf_counter

import pytest

from app.shared.config import get_settings

from ..module05.test_canvas import API, create_draft, setup_task


@pytest.mark.skipif(not os.getenv("STUDIO_M4_CAPACITY"), reason="opt-in capacity baseline")
def test_typical_reads_and_fifty_item_batch(client, db, monkeypatch):
    assert os.environ["STUDIO_TEST_IMAGE_DATABASE"].split("/")[-1].startswith("studio_m4_")
    headers, product, _, task = setup_task(client, db)
    settings = get_settings()
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)
    monkeypatch.setattr(settings, "image_budget_cents", 200)
    monkeypatch.setattr(settings, "image_budget_unlimited", False)
    url = f"{API}/tasks/{task['id']}"
    items = [
        create_draft(
            client, headers, task, product, entry="batch", primary=False,
            parameters={"count": 2}, prompt=f"Capacity test item {item}",
        )
        for item in range(50)
    ]

    def read(index):
        path = (url, f"{url}/canvas", f"{url}/results")[index % 3]
        start = perf_counter()
        response = client.get(path)
        assert response.status_code == 200, response.text
        return (perf_counter() - start) * 1000

    read(0)
    reads = sorted(read(index) for index in range(90))
    p95 = reads[math.ceil(len(reads) * 0.95) - 1]
    start = perf_counter()
    response = client.post(f"{url}/batches/image/executions", headers=headers, json={
        "idempotency_key": "m4-capacity-50",
        "items": [{"id": draft["id"], "expected_version": draft["version"]} for draft in items],
    })
    accepted_ms = (perf_counter() - start) * 1000
    assert response.status_code == 202, response.text
    assert sum(len(row["execution"]["outputs"]) for row in response.json()) == 100
    print(f"api_read_p95_ms={p95:.1f} requests=90 clients=1 batch_accept_ms={accepted_ms:.1f}")
    assert p95 <= 500
    assert accepted_ms <= 2000
