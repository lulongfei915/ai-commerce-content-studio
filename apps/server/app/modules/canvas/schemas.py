from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.modules.cases.schemas import UsagePurpose
from app.modules.creation.schemas import CreationView, ReferenceUsage
from app.modules.products.schemas import WriteSchema

NodeId = Annotated[str, StringConstraints(pattern=r"^(creation|upload|case|result):[^:]{1,36}$")]
Coordinate = Annotated[float, Field(ge=-10_000_000, le=10_000_000)]


class Point(WriteSchema):
    x: Coordinate
    y: Coordinate


class NodePosition(Point):
    id: NodeId


class LayoutEdit(WriteSchema):
    expected_version: int = Field(ge=0)
    positions: list[NodePosition] = Field(max_length=1000)


class LayoutView(BaseModel):
    version: int = 0
    positions: list[NodePosition] = Field(default_factory=list)


class ViewportPoint(Point):
    zoom: float = Field(ge=0.1, le=2)


class ViewportEdit(ViewportPoint):
    expected_version: int = Field(ge=0)


class ViewportView(ViewportPoint):
    version: int


class CanvasNode(BaseModel):
    id: str
    kind: Literal["creation", "upload", "case", "result"]
    source_id: str
    label: str
    media: Literal["image", "video"]
    product_id: str | None = None
    source_creation_id: str | None = None
    file_id: str | None = None
    file_version: int | None = None
    source_version: int | None = None
    status: str
    allowed_purposes: list[UsagePurpose] | None = None
    previewable: bool = False
    referenceable: bool = False
    execution_id: str | None = None


class CanvasEdge(BaseModel):
    id: str
    source: str
    target: str
    usage: ReferenceUsage


class CanvasView(BaseModel):
    layout: LayoutView
    viewport: ViewportView | None
    nodes: list[CanvasNode]
    edges: list[CanvasEdge]
    creations: list[CreationView]
