from typing import Literal

from pydantic import BaseModel, Field

from app.modules.products.schemas import Category, ResourceId, WriteSchema

UsagePurpose = Literal["main", "detail", "video"]
Media = Literal["image", "video"]


class CaseCreate(WriteSchema):
    name: str = Field(min_length=1, max_length=120)
    category: Category
    file_id: ResourceId
    source: str = Field(min_length=1, max_length=300)
    usage_scope: str | None = Field(default=None, max_length=300)
    usage_purposes: list[UsagePurpose] = Field(default_factory=list, max_length=3)


class CaseLicense(WriteSchema):
    expected_version: int = Field(ge=1)
    usage_scope: str | None = Field(max_length=300)
    usage_purposes: list[UsagePurpose] = Field(default_factory=list, max_length=3)


class CaseView(CaseCreate):
    id: str
    media: Media
    file_version: int
    version: int


class CasePage(BaseModel):
    items: list[CaseView]
    next_cursor: str | None
