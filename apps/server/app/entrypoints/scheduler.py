import logging
from time import sleep

from sqlalchemy import or_, select

from app.api.router import api_router  # noqa: F401
from app.modules.creation.models import CreationOutput
from app.modules.execution.models import ImageStep
from app.shared.db import SessionLocal

from .worker import celery_app


def dispatch() -> None:
    from datetime import datetime

    with SessionLocal() as db:
        identifiers = list(
            db.scalars(
                select(ImageStep.output_id)
                .join(CreationOutput)
                .where(
                    CreationOutput.status.in_(
                        ("queued", "saving", "generating")
                    ),
                    or_(ImageStep.lease.is_(None), ImageStep.lease <= datetime.utcnow()),
                )
            )
        )
    for identifier in identifiers:
        celery_app.send_task("studio.process_image", args=[identifier], expires=30)


def run() -> None:
    while True:
        try:
            dispatch()
        except Exception:
            logging.getLogger(__name__).exception("Image dispatch unavailable")
        sleep(5)


if __name__ == "__main__":
    run()
