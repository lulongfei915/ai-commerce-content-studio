from fastapi import HTTPException
from sqlalchemy import select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile

from .facts import PURPOSES, missing_inputs, validate_fields
from .models import Product, ProductFact, ProductPhotoBinding
from .schemas import FactsUpdate, ProductCreate, ProductPhoto, ProductResponse, ProductUpdate


def get_product(db: Session, tenant: str, product_id: str, *, lock: bool = False) -> Product:
    query = select(Product).where(Product.tenant_id == tenant, Product.id == product_id)
    product = db.scalar(query.with_for_update() if lock else query)
    if product is None:
        raise HTTPException(404, "product_not_found")
    return product


def get_fact(db: Session, product: Product, version: int, *, lock: bool = False) -> ProductFact:
    query = select(ProductFact).where(
        ProductFact.tenant_id == product.tenant_id,
        ProductFact.product_id == product.id,
        ProductFact.version == version,
    )
    fact = db.scalar(query.with_for_update() if lock else query)
    if fact is None:
        raise HTTPException(404, "product_fact_not_found")
    return fact


def _photos(db: Session, product: Product, ids: list[str]) -> list[dict[str, str | int]]:
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "product_photo_duplicate")
    if not ids:
        return []
    media = {
        item.id: item
        for item in db.scalars(
            select(PrivateFile)
            .where(
                PrivateFile.tenant_id == product.tenant_id,
                PrivateFile.id.in_(ids),
            )
            .order_by(PrivateFile.id)
            .with_for_update()
        )
    }
    # Locking read also sees bindings committed after the session began on MySQL.
    bindings = {
        item.file_id: item
        for item in db.scalars(
            select(ProductPhotoBinding)
            .where(
                ProductPhotoBinding.tenant_id == product.tenant_id,
                ProductPhotoBinding.file_id.in_(ids),
            )
            .with_for_update()
        )
    }
    photos: list[dict[str, str | int]] = []
    for file_id in ids:
        item = media.get(file_id)
        if item is None:
            raise HTTPException(404, "product_photo_not_found")
        if (
            item.status != "ready"
            or item.object_key is None
            or item.content_type not in {"image/jpeg", "image/png", "image/webp"}
            or item.size_bytes > 10 * 1024 * 1024
        ):
            raise HTTPException(422, "product_photo_invalid")
        binding = bindings.get(file_id)
        if binding is not None and binding.product_id != product.id:
            raise HTTPException(409, "product_photo_other_sku")
        if binding is None:
            db.add(
                ProductPhotoBinding(
                    file_id=file_id, tenant_id=product.tenant_id, product_id=product.id
                )
            )
        photos.append({"file_id": file_id, "version": item.version})
    return photos


def product_view(product: Product, fact: ProductFact) -> ProductResponse:
    return ProductResponse.model_validate(
        {
            "id": product.id,
            "name": product.name,
            "sku": product.sku,
            "category": product.category,
            "version": product.version,
            "fact_version": fact.version,
            "facts": fact.facts,
            "photos": fact.photos,
            "readiness": {
                p: missing_inputs(product.category, set(fact.facts), bool(fact.photos), p)
                for p in PURPOSES
            },
        }
    )


def product_views(db: Session, tenant: str, products: list[Product]) -> list[ProductResponse]:
    if not products:
        return []
    facts = {
        item.product_id: item
        for item in db.scalars(
            select(ProductFact).where(
                ProductFact.tenant_id == tenant,
                tuple_(ProductFact.product_id, ProductFact.version).in_(
                    [(item.id, item.fact_version) for item in products]
                ),
            )
        )
    }
    return [product_view(item, facts[item.id]) for item in products]


def _check_version(product: Product, expected: int) -> None:
    if product.version != expected:
        raise HTTPException(409, {"code": "version_conflict", "version": product.version})


def create_product(db: Session, tenant: str, user: str, data: ProductCreate) -> ProductResponse:
    validate_fields(data.category, data.facts)
    product = Product(
        tenant_id=tenant,
        created_by=user,
        sku=data.sku,
        name=data.name,
        category=data.category,
    )
    db.add(product)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "product_sku_duplicate") from exc
    fact = ProductFact(
        tenant_id=tenant,
        product_id=product.id,
        version=1,
        created_by=user,
        facts={k: v.model_dump() for k, v in data.facts.items()},
        photos=_photos(db, product, data.photo_ids),
    )
    db.add(fact)
    db.commit()
    return product_view(product, fact)


def update_product(db: Session, product: Product, data: ProductUpdate) -> ProductResponse:
    _check_version(product, data.expected_version)
    fact = get_fact(db, product, product.fact_version, lock=True)
    product.name = data.name
    product.version += 1
    db.commit()
    return product_view(product, fact)


def add_facts(db: Session, product: Product, user: str, data: FactsUpdate) -> ProductResponse:
    _check_version(product, data.expected_version)
    if data.facts is None and data.photo_ids is None:
        raise HTTPException(422, "product_fact_update_empty")
    previous = get_fact(db, product, product.fact_version, lock=True)
    facts = previous.facts
    if data.facts is not None:
        validate_fields(product.category, data.facts)
        facts = {k: v.model_dump() for k, v in data.facts.items()}
    photos = previous.photos if data.photo_ids is None else _photos(db, product, data.photo_ids)
    product.version += 1
    product.fact_version += 1
    fact = ProductFact(
        tenant_id=product.tenant_id,
        product_id=product.id,
        version=product.fact_version,
        created_by=user,
        facts=facts,
        photos=photos,
    )
    db.add(fact)
    db.commit()
    return product_view(product, fact)


def require_generation_inputs(
    db: Session, product: Product, purpose: str, *, require_complete: bool = True
) -> list[ProductPhoto]:
    """Check bound photos and, for production workflows, SKU completeness."""
    fact = get_fact(db, product, product.fact_version)
    photos = [ProductPhoto.model_validate(photo) for photo in fact.photos]
    if purpose not in {*PURPOSES, "clip"}:
        raise HTTPException(422, "generation_purpose_invalid")
    ids = [photo.file_id for photo in photos]
    actual = {
        item.id: item.version
        for item in db.scalars(
            select(PrivateFile)
            .join(
                ProductPhotoBinding,
                PrivateFile.id == ProductPhotoBinding.file_id,
            )
            .where(
                PrivateFile.tenant_id == product.tenant_id,
                ProductPhotoBinding.tenant_id == product.tenant_id,
                ProductPhotoBinding.product_id == product.id,
                PrivateFile.id.in_(ids),
                PrivateFile.status == "ready",
                PrivateFile.object_key.is_not(None),
            )
        )
    }
    issues = []
    if require_complete:
        issues = missing_inputs(
            product.category,
            set(fact.facts),
            bool(photos),
            "video" if purpose == "clip" else purpose,
        )
    if any(actual.get(photo.file_id) != photo.version for photo in photos):
        issues.append("product_photo_invalid")
    if issues:
        raise HTTPException(422, {"code": "product_inputs_incomplete", "fields": issues})
    return photos
