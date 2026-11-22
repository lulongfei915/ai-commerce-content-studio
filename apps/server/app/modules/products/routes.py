from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)

from .facts import CATEGORIES
from .models import Product
from .schemas import (
    Category,
    CategoryFields,
    FactsUpdate,
    ProductCreate,
    ProductList,
    ProductResponse,
    ProductUpdate,
)
from .service import (
    add_facts,
    create_product,
    get_fact,
    get_product,
    product_view,
    product_views,
    update_product,
)

router = APIRouter(prefix="/products", tags=["商品"])


@router.get("/categories", operation_id="listProductCategories")
def categories(identity: ActiveIdentity) -> list[CategoryFields]:
    require_permission(identity, Permission.VIEW)
    return list(CATEGORIES.values())


@router.get("", operation_id="listProducts")
def list_products(
    identity: ActiveIdentity,
    db: Database,
    q: Annotated[str, Query(max_length=100)] = "",
    category: Category | None = None,
    cursor: Annotated[str | None, Query(max_length=36)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> ProductList:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    query = select(Product).where(Product.tenant_id == tenant)
    if q.strip():
        query = query.where(
            or_(
                Product.name.contains(q.strip(), autoescape=True),
                Product.sku.icontains(q.strip(), autoescape=True),
            )
        )
    if category:
        query = query.where(Product.category == category)
    if cursor:
        query = query.where(Product.id > cursor)
    page = list(db.scalars(query.order_by(Product.id).limit(limit + 1)))
    return ProductList(
        items=product_views(db, tenant, page[:limit]),
        next_cursor=page[limit - 1].id if len(page) > limit else None,
    )


@router.post("", status_code=201, operation_id="createProduct")
def create(data: ProductCreate, identity: WriteIdentity, db: Database) -> ProductResponse:
    require_permission(identity, Permission.CREATE)
    return create_product(db, identity.tenant.id, identity.user.id, data)


@router.get("/{product_id}", operation_id="getProduct")
def get(product_id: str, identity: ActiveIdentity, db: Database) -> ProductResponse:
    require_permission(identity, Permission.VIEW)
    product = get_product(db, identity.tenant.id, product_id)
    return product_view(product, get_fact(db, product, product.fact_version))


@router.patch("/{product_id}", operation_id="updateProduct")
def update(
    product_id: str, data: ProductUpdate, identity: WriteIdentity, db: Database
) -> ProductResponse:
    require_permission(identity, Permission.CREATE)
    return update_product(db, get_product(db, identity.tenant.id, product_id, lock=True), data)


@router.post("/{product_id}/facts", status_code=201, operation_id="createProductFacts")
def facts(
    product_id: str, data: FactsUpdate, identity: WriteIdentity, db: Database
) -> ProductResponse:
    require_permission(identity, Permission.CREATE)
    product = get_product(db, identity.tenant.id, product_id, lock=True)
    return add_facts(db, product, identity.user.id, data)


@router.get("/{product_id}/facts/{version}", operation_id="getProductFacts")
def history(
    product_id: str, version: int, identity: ActiveIdentity, db: Database
) -> ProductResponse:
    require_permission(identity, Permission.VIEW)
    product = get_product(db, identity.tenant.id, product_id)
    return product_view(product, get_fact(db, product, version))
