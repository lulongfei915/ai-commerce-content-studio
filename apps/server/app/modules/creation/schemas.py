from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.products.schemas import ResourceId, WriteSchema
from app.modules.templates.schemas import ImagePurpose, VersionInput
from app.shared.studio_errors import FieldIssue

from .capabilities import ImageParameters, SizeOption


class CreationCreate(WriteSchema):
    model_config = ConfigDict(str_strip_whitespace=False)

    product_id: ResourceId
    purpose: ImagePurpose
    prompt: str = Field(default="", max_length=6000)
    parameters: ImageParameters = Field(default_factory=ImageParameters)
    primary: bool = True


class CreationEdit(VersionInput):
    model_config = ConfigDict(str_strip_whitespace=False)

    prompt: str | None = Field(default=None, max_length=6000)
    parameters: ImageParameters | None = None


class ApplyTemplate(VersionInput):
    template_id: ResourceId
    template_version: int = Field(ge=1)
    prompt_action: Literal["keep", "replace"]


class ReferenceInput(WriteSchema):
    kind: Literal["case", "upload"]
    source_id: ResourceId
    usage: Literal["expression", "composition", "lighting"] = "expression"


class ReferenceCreate(ReferenceInput, VersionInput):
    pass


class ReferenceEdit(VersionInput):
    usage: Literal["expression", "composition", "lighting"]


class ReferenceView(ReferenceInput):
    id: str
    origin: Literal["independent", "template"]
    file_id: str
    file_version: int
    source_version: int
    label: str


class CreationView(BaseModel):
    id: str
    task_id: str
    product_id: str
    purpose: ImagePurpose
    slot: str
    prompt: str
    parameters: ImageParameters
    references: list[ReferenceView]
    template_id: str | None
    template_version: int | None
    version: int


class Readiness(BaseModel):
    issues: list[FieldIssue]


class Capabilities(BaseModel):
    model: str
    max_outputs: int
    sizes: list[SizeOption]
