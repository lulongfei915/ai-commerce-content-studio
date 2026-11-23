from celery import Celery

from ..shared.config import get_settings

settings = get_settings()
celery_app = Celery("studio", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_track_started=True, task_serializer="json", result_serializer="json")


@celery_app.task(name="studio.process_image", ignore_result=True)  # type: ignore[untyped-decorator]
def process_image(output_id: str) -> None:
    from app.adapters.object_storage import get_object_storage
    from app.api.router import api_router  # noqa: F401
    from app.modules.execution.runner import process
    from app.shared.db import SessionLocal

    with SessionLocal() as db:
        process(db, output_id, get_object_storage(), settings)
