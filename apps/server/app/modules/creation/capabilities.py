from typing import Literal

from typing_extensions import TypedDict

from app.modules.products.schemas import WriteSchema
from app.shared.config import Settings, get_settings
from app.shared.studio_errors import reject

MODEL = "seedream-5.5"
MAX_REFERENCES = 10
MAX_IMAGE_TOTAL = 15
MAX_OUTPUTS = 6
ImageProvider = Literal["ark", "gpt-image"]


class ImageParameters(WriteSchema):
    provider: ImageProvider = "ark"
    model: str = MODEL
    ratio: str = "1:1"
    resolution: str = "1K"
    count: int = 1
    quality: str | None = None


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

GPT_SIZES: list[SizeOption] = [
    {"ratio": "1:1", "resolution": "1K", "width": 1024, "height": 1024},
    {"ratio": "1:1", "resolution": "1.5K", "width": 1536, "height": 1536},
    {"ratio": "1:1", "resolution": "2K", "width": 2048, "height": 2048},
    {"ratio": "3:4", "resolution": "1.5K", "width": 1152, "height": 1536},
    {"ratio": "3:4", "resolution": "2K", "width": 1536, "height": 2048},
]
GPT_QUALITIES = ("low", "medium", "high", "auto")
GPT_MODELS = {
    "gpt-image-2": GPT_QUALITIES,
    "gpt-image-2.6": GPT_QUALITIES,
    "gpt-image-2.5-flare": (*GPT_QUALITIES, "xhigh", "max"),
    "gpt-image-2.5-sunburst": (*GPT_QUALITIES, "xhigh", "max"),
    "gpt-image-2.6-flare": (*GPT_QUALITIES, "xhigh", "max"),
    "gpt-image-2.6-sunburst": (*GPT_QUALITIES, "xhigh", "max"),
}


class ImageModelOption(TypedDict):
    provider: ImageProvider
    model: str
    label: str
    sizes: list[SizeOption]
    qualities: list[str]
    default_quality: str | None


def image_models(settings: Settings) -> list[ImageModelOption]:
    models: list[ImageModelOption] = [
        {
            "provider": "ark", "model": MODEL, "label": "Seedream 5.5", "sizes": SIZES,
            "qualities": [], "default_quality": None,
        }
    ]
    key = settings.itaiapi_api_key
    if key is None or not key.get_secret_value().strip():
        return models
    for name in dict.fromkeys(part.strip() for part in settings.itaiapi_image_models.split(",")):
        qualities = GPT_MODELS.get(name)
        if qualities:
            models.append({
                "provider": "gpt-image", "model": name, "label": name, "sizes": GPT_SIZES,
                "qualities": list(qualities), "default_quality": "low",
            })
    return models


def validate_parameters(
    parameters: ImageParameters, inputs: int = 0, *, settings: Settings | None = None
) -> SizeOption:
    option = next(
        (item for item in image_models(settings or get_settings())
         if (item["provider"], item["model"]) == (parameters.provider, parameters.model)),
        None,
    )
    if option is None:
        reject("parameters.model", "model_unsupported")
    if parameters.quality is not None and parameters.quality not in option["qualities"]:
        reject("parameters.quality", "quality_unsupported")
    ratios = [size for size in option["sizes"] if size["ratio"] == parameters.ratio]
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
