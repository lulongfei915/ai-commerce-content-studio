from fastapi import APIRouter

from app.modules.assets.routes import router as assets_router
from app.modules.canvas.routes import router as canvas_router
from app.modules.cases.routes import router as cases_router
from app.modules.creation.routes import router as creation_router
from app.modules.identity.routes import router as identity_router
from app.modules.products.preview import router as product_preview_router
from app.modules.products.routes import router as products_router
from app.modules.tasks.routes import router as tasks_router
from app.modules.templates.routes import router as templates_router

from .health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(identity_router)
api_router.include_router(assets_router)
api_router.include_router(products_router)
api_router.include_router(tasks_router)
api_router.include_router(canvas_router)
api_router.include_router(product_preview_router)
api_router.include_router(cases_router)
api_router.include_router(creation_router)
api_router.include_router(templates_router)
