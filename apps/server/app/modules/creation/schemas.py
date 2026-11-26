from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.cases.schemas import UsagePurpose
from app.modules.products.schemas import ProductPhoto, ResourceId, WriteSchema
from app.modules.templates.schemas import VersionInput
from app.modules.templates.schemas import VideoParameters as VideoParameters
from app.shared.studio_errors import FieldIssue

from .capabilities import ImageModelOption, ImageParameters, SizeOption

CreationEntry = Literal["quick", "canvas", "batch"]


class CreationCreate(WriteSchema):
    model_config = ConfigDict(str_strip_whitespace=False)

    product_id: ResourceId
    purpose: UsagePurpose
    prompt: str = Field(default="", max_length=6000)
    parameters: ImageParameters = Field(default_factory=ImageParameters)
    video_parameters: VideoParameters | None = None
    primary: bool = True
    entry: CreationEntry = "quick"
    position_id: ResourceId | None = None


class CreationEdit(VersionInput):
    model_config = ConfigDict(str_strip_whitespace=False)

    prompt: str | None = Field(default=None, max_length=6000)
    parameters: ImageParameters | None = None
    video_parameters: VideoParameters | None = None


class ApplyTemplate(VersionInput):
    template_id: ResourceId
    template_version: int = Field(ge=1)
    prompt_action: Literal["keep", "replace"]


class ReuseDraft(VersionInput):
    source_id: ResourceId
    source_version: int = Field(ge=1)


ReferenceUsage = Literal[
    "product", "expression", "composition", "lighting", "first_frame", "last_frame"
]


class ReferenceInput(WriteSchema):
    kind: Literal["case", "upload", "result"]
    source_id: ResourceId
    usage: ReferenceUsage = "expression"


class ReferenceCreate(ReferenceInput, VersionInput):
    company_library: bool = False
    file_version: int | None = Field(default=None, ge=1)
    source_version: int | None = Field(default=None, ge=1)


class ReferenceEdit(VersionInput):
    usage: ReferenceUsage


class ReferenceView(ReferenceInput):
    id: str
    origin: Literal["independent", "template"]
    file_id: str
    file_version: int
    source_version: int
    label: str
    media: Literal["image", "video"] = "image"


class CreationView(BaseModel):
    id: str
    task_id: str
    product_id: str
    purpose: UsagePurpose
    slot: str
    entry: CreationEntry | None = None
    prompt: str
    parameters: ImageParameters
    video_parameters: VideoParameters | None = None
    references: list[ReferenceView]
    template_id: str | None
    template_version: int | None
    version: int
    batch_position_id: str | None = None
    batch_overrides: list[str] | None = None


class Readiness(BaseModel):
    issues: list[FieldIssue]


class InputSnapshot(BaseModel):
    draft: CreationView
    product_fact_version: int
    product_photos: list[ProductPhoto]
    references: list[ReferenceView]


class Capabilities(BaseModel):
    model: str
    max_outputs: int
    sizes: list[SizeOption]
    models: list[ImageModelOption]
