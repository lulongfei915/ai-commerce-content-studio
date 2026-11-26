from typing import Literal

from pydantic import BaseModel, Field

from app.modules.creation.capabilities import ImageParameters
from app.modules.products.schemas import Category, ResourceId, Text, WriteSchema

TemplatePurpose = Literal["main", "detail", "video"]


class VideoParameters(WriteSchema):
    model: Literal["seedance-2.0", "seedance-2.5"] = "seedance-2.0"
    ratio: Literal["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"] = "16:9"
    resolution: Literal["480p", "720p", "1080p", "4k"] = "720p"
    duration: int = Field(default=5, ge=4, le=30, strict=True)
    count: int = Field(default=1, ge=1, le=6)


class TemplateContent(WriteSchema):
    name: str = Field(min_length=1, max_length=120)
    category: Category
    purpose: TemplatePurpose
    video_parameters: VideoParameters | None = None
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
    published_content: TemplateContent | None = None
    has_unpublished_changes: bool = False


class TemplatePage(BaseModel):
    items: list[TemplateView]
    next_cursor: str | None
