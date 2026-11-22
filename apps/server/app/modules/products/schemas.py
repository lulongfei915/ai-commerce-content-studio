from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Category = Literal["apparel", "beauty", "home", "digital"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
ResourceId = Annotated[str, StringConstraints(min_length=1, max_length=36)]


class WriteSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ConfirmedFact(WriteSchema):
    value: Text
    evidence: Text


class ProductCreate(WriteSchema):
    sku: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=80)
    category: Category
    facts: dict[str, ConfirmedFact] = Field(default_factory=dict, max_length=20)
    photo_ids: list[ResourceId] = Field(default_factory=list, max_length=8)

    @field_validator("sku", mode="before")
    @classmethod
    def normalize_sku(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value


class ProductUpdate(WriteSchema):
    expected_version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=80)


class FactsUpdate(WriteSchema):
    expected_version: int = Field(ge=1)
    facts: dict[str, ConfirmedFact] | None = Field(default=None, max_length=20)
    photo_ids: list[ResourceId] | None = Field(default=None, max_length=8)


class ProductPhoto(BaseModel):
    file_id: str
    version: int


class FactField(BaseModel):
    key: str
    label: str
    required_for: list[str]


class CategoryFields(BaseModel):
    id: Category
    label: str
    fields: list[FactField]


class ProductResponse(BaseModel):
    id: str
    sku: str
    name: str
    category: Category
    version: int
    fact_version: int
    facts: dict[str, ConfirmedFact]
    photos: list[ProductPhoto]
    readiness: dict[str, list[str]]


class ProductList(BaseModel):
    items: list[ProductResponse]
    next_cursor: str | None = None
