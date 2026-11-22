from typing import Literal

from pydantic import BaseModel, Field

from app.modules.creation.capabilities import ImageParameters
from app.modules.products.schemas import Category, ResourceId, Text, WriteSchema

ImagePurpose = Literal["main", "detail"]


class TemplateContent(WriteSchema):
    name: str = Field(min_length=1, max_length=120)
    category: Category
    purpose: ImagePurpose
    prompt: str = Field(default="", max_length=6000)
    parameters: ImageParameters = Field(default_factory=ImageParameters)
    case_ids: list[ResourceId] = Field(default_factory=list, max_length=10)
    check_rules: list[Text] = Field(default_factory=list, max_length=20)


class VersionInput(WriteSchema):
    expected_version: int = Field(ge=1)


class TemplateEdit(TemplateContent, VersionInput):
    pass


class TemplateStatus(VersionInput):
    enabled: bool


class TemplateView(BaseModel):
    id: str
    version: int
    enabled: bool
    published_version: int | None
    content: TemplateContent


class TemplatePage(BaseModel):
    items: list[TemplateView]
    next_cursor: str | None
