from fastapi import HTTPException

from .schemas import Category, CategoryFields, ConfirmedFact, FactField

PURPOSES = ("main", "detail", "video")


def field(key: str, label: str, *required_for: str) -> FactField:
    return FactField(key=key, label=label, required_for=list(required_for))


SELLING_POINT = field("selling_point", "卖点")
CATEGORIES: dict[Category, CategoryFields] = {
    "apparel": CategoryFields(
        id="apparel",
        label="鞋服",
        fields=[
            field("color", "颜色", *PURPOSES),
            field("size", "尺码", *PURPOSES),
            field("structure", "版型或结构", *PURPOSES),
            field("material", "材质"),
            SELLING_POINT,
        ],
    ),
    "beauty": CategoryFields(
        id="beauty",
        label="美妆个护",
        fields=[
            field("capacity", "容量", *PURPOSES),
            field("packaging", "包装形态", *PURPOSES),
            field("label", "商品标签", *PURPOSES),
            field("shade", "色号"),
            field("ingredients", "已确认成分"),
            field("efficacy", "已确认功效"),
            SELLING_POINT,
        ],
    ),
    "home": CategoryFields(
        id="home",
        label="家居日用",
        fields=[
            field("dimensions", "尺寸", *PURPOSES),
            field("structure", "结构", *PURPOSES),
            field("parts", "部件", "detail", "video"),
            SELLING_POINT,
        ],
    ),
    "digital": CategoryFields(
        id="digital",
        label="数码配件",
        fields=[
            field("dimensions", "尺寸", *PURPOSES),
            field("structure", "结构", *PURPOSES),
            field("compatibility", "接口或适配信息", "detail", "video"),
            SELLING_POINT,
        ],
    ),
}


def validate_fields(category: Category, facts: dict[str, ConfirmedFact]) -> None:
    allowed = {item.key for item in CATEGORIES[category].fields}
    if facts.keys() - allowed:
        raise HTTPException(422, "product_fact_field_invalid")


def missing_inputs(category: Category, facts: set[str], has_photo: bool, purpose: str) -> list[str]:
    required = [f.key for f in CATEGORIES[category].fields if purpose in f.required_for]
    return ([] if has_photo else ["photo_required"]) + [key for key in required if key not in facts]
