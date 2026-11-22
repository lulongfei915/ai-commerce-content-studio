from celery import Celery

from ..shared.config import get_settings

settings = get_settings()
celery_app = Celery("studio", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_track_started=True, task_serializer="json", result_serializer="json")
