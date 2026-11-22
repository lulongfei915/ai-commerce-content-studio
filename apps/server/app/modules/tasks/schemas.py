from typing import Literal

from pydantic import BaseModel, Field

from app.modules.products.schemas import ProductResponse, ResourceId, WriteSchema

Purpose = Literal["main", "detail", "video"]


class TaskCreate(WriteSchema):
    product_ids: list[ResourceId] = Field(min_length=1, max_length=50)
    contents: list[Purpose] = Field(min_length=1, max_length=3)
    name: str | None = Field(default=None, max_length=200)


class TaskProductAdd(WriteSchema):
    expected_version: int = Field(ge=1)
    product_ids: list[ResourceId] = Field(min_length=1, max_length=50)


class TaskUpdate(WriteSchema):
    expected_version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=200)


class PositionResponse(BaseModel):
    id: str
    product_id: str
    purpose: Purpose
    status: str


class TaskSummary(BaseModel):
    id: str
    name: str
    status: str
    version: int


class TaskResponse(TaskSummary):
    products: list[ProductResponse]
    positions: list[PositionResponse]


class TaskList(BaseModel):
    items: list[TaskSummary]
    next_cursor: str | None = None
