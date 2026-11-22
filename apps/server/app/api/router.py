from fastapi import APIRouter

from app.modules.assets.routes import router as assets_router
from app.modules.identity.routes import router as identity_router

from .health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(identity_router)
api_router.include_router(assets_router)
