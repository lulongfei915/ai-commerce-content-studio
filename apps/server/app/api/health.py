from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.shared.db import engine

router = APIRouter(tags=["system"])


@router.get("/health", response_model=dict[str, str])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "studio-api"}


@router.get("/ready", include_in_schema=False)
def ready() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    except SQLAlchemyError as exc:
        raise HTTPException(503, "database_not_ready") from exc
    return {"status": "ready"}
