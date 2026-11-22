from fastapi import APIRouter

from app.modules.assets.routes import router as assets_router
from app.modules.identity.routes import router as identity_router
from app.modules.products.preview import router as product_preview_router
from app.modules.products.routes import router as products_router
from app.modules.tasks.routes import router as tasks_router

from .health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(identity_router)
api_router.include_router(assets_router)
api_router.include_router(products_router)
api_router.include_router(tasks_router)
api_router.include_router(product_preview_router)
