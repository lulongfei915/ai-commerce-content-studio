from typing_extensions import TypedDict

from app.modules.products.schemas import WriteSchema
from app.shared.studio_errors import reject

MODEL = "seedream-5.5"
MAX_REFERENCES = 10
MAX_IMAGE_TOTAL = 15
MAX_OUTPUTS = 6


class ImageParameters(WriteSchema):
    model: str = MODEL
    ratio: str = "1:1"
    resolution: str = "1K"
    count: int = 1


class SizeOption(TypedDict):
    ratio: str
    resolution: str
    width: int
    height: int


SIZES: list[SizeOption] = [
    {"ratio": "1:1", "resolution": "1K", "width": 1024, "height": 1024},
    {"ratio": "1:1", "resolution": "1.5K", "width": 1536, "height": 1536},
    {"ratio": "1:1", "resolution": "2K", "width": 2048, "height": 2048},
    {"ratio": "3:4", "resolution": "2K", "width": 1728, "height": 2304},
    {"ratio": "4:3", "resolution": "2K", "width": 2304, "height": 1728},
    {"ratio": "9:16", "resolution": "2K", "width": 1440, "height": 2560},
    {"ratio": "16:9", "resolution": "2K", "width": 2560, "height": 1440},
]


def validate_parameters(parameters: ImageParameters, inputs: int = 0) -> SizeOption:
    if parameters.model != MODEL:
        reject("parameters.model", "model_unsupported")
    ratios = [size for size in SIZES if size["ratio"] == parameters.ratio]
    if not ratios:
        reject("parameters.ratio", "ratio_unsupported")
    size = next((item for item in ratios if item["resolution"] == parameters.resolution), None)
    if size is None:
        reject("parameters.resolution", "resolution_unsupported")
    if inputs > MAX_REFERENCES:
        reject("references", "reference_limit")
    if not 1 <= parameters.count <= MAX_OUTPUTS or inputs + parameters.count > MAX_IMAGE_TOTAL:
        reject("parameters.count", "output_count_unsupported")
    return size
