import logging
from collections import deque
from collections.abc import Iterable
from datetime import datetime
from time import sleep

from sqlalchemy import case, or_, select

from app.api.router import api_router  # noqa: F401
from app.modules.creation.models import CreationOutput
from app.modules.execution.models import Execution, ImageStep
from app.shared.config import get_settings
from app.shared.db import SessionLocal
from app.shared.entitlements import paid_call_block

from .worker import celery_app


def dispatch_order(
    rows: Iterable[tuple[str, str, str]], *, after_tenant: str = "", queued_limit: int = 32,
) -> list[str]:
    recovery = []
    queued: dict[str, deque[str]] = {}
    for identifier, tenant, status in rows:
        if status in ("saving", "generating"):
            recovery.append(identifier)
        else:
            queued.setdefault(tenant, deque()).append(identifier)
    tenants = deque(sorted(queued, key=lambda tenant: (tenant <= after_tenant, tenant)))
    selected: list[str] = []
    while tenants and len(selected) < queued_limit:
        tenant = tenants.popleft()
        selected.append(queued[tenant].popleft())
        if queued[tenant]:
            tenants.append(tenant)
    return recovery + selected


def dispatch(after_tenant: str = "") -> str:
    statuses: tuple[str, ...] = ("saving", "generating")
    if not paid_call_block(get_settings()):
        statuses += ("queued",)
    with SessionLocal() as db:
        result = db.execute(
            select(ImageStep.output_id, Execution.tenant_id, CreationOutput.status)
            .join(CreationOutput, CreationOutput.id == ImageStep.output_id)
            .join(Execution, Execution.id == ImageStep.execution_id)
            .where(
                CreationOutput.status.in_(statuses),
                or_(ImageStep.lease.is_(None), ImageStep.lease <= datetime.utcnow()),
            )
            .order_by(
                case({"saving": 0, "generating": 1}, value=CreationOutput.status, else_=2),
                Execution.created_at, CreationOutput.output_index, ImageStep.output_id,
            )
        )
        rows = [(identifier, tenant, status) for identifier, tenant, status in result]
    identifiers = dispatch_order(rows, after_tenant=after_tenant)
    queued = {identifier: tenant for identifier, tenant, status in rows if status == "queued"}
    for identifier in identifiers:
        celery_app.send_task("studio.process_image", args=[identifier], expires=30)
    return next((queued[item] for item in identifiers if item in queued), after_tenant)


def run() -> None:
    after_tenant = ""
    while True:
        try:
            after_tenant = dispatch(after_tenant)
        except Exception:
            logging.getLogger(__name__).exception("Image dispatch unavailable")
        sleep(5)


if __name__ == "__main__":
    run()
