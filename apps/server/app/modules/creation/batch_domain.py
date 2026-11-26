from typing import Any

from fastapi import HTTPException
from sqlalchemy import JSON, ForeignKey, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.modules.execution.models import Execution
from app.shared.db import Base

from .models import Creation


class BatchConfig(Base):
    __tablename__ = "batch_configs"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    media: Mapped[str] = mapped_column(String(5), primary_key=True)
    version: Mapped[int] = mapped_column(default=1)
    values: Mapped[dict[str, Any]] = mapped_column(JSON)


class BatchRequest(Base):
    __tablename__ = "batch_requests"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    executions: Mapped[list[str]] = mapped_column(JSON)


def media_for(item: Creation) -> str:
    return "video" if item.purpose == "video" else "image"


def submitted(db: Session, item: Creation) -> bool:
    return db.scalar(
        select(Execution.id).where(Execution.creation_id == item.id).limit(1).with_for_update()
    ) is not None


def require_unsubmitted(db: Session, item: Creation) -> None:
    if item.entry == "batch" and submitted(db, item):
        raise HTTPException(409, "batch_item_submitted")


def override(item: Creation, *fields: str) -> None:
    if item.entry == "batch":
        current = item.batch_overrides
        if current is None:
            current = ["prompt", *item.parameters, *(item.video_parameters or {})]
        changes = set(fields)
        if changes & {"ratio", "resolution", "model", "provider"}:
            changes.update(("ratio", "resolution"))
        item.batch_overrides = sorted(set(current) | changes)


def apply_public(item: Creation, values: dict[str, Any]) -> bool:
    if item.batch_overrides is None:
        return False  # Legacy items are explicitly configured.
    inherited = {k: v for k, v in values.items() if k not in item.batch_overrides}
    if {"ratio", "resolution"} & set(item.batch_overrides):
        inherited.pop("ratio", None)
        inherited.pop("resolution", None)
    changed = "prompt" in inherited and item.prompt != inherited["prompt"]
    if "prompt" in inherited:
        item.prompt = inherited.pop("prompt")
    current = item.video_parameters if item.purpose == "video" else item.parameters
    assert current is not None
    updated = {**current, **inherited}
    if current != updated:
        changed = True
        if item.purpose == "video":
            item.video_parameters = updated
        else:
            item.parameters = updated
    return changed
