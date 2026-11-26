from fastapi import APIRouter

from app.modules.assets.routes import router as assets_router
from app.modules.canvas.routes import router as canvas_router
from app.modules.cases.routes import router as cases_router
from app.modules.creation.batch import router as batch_router
from app.modules.creation.results import router as results_router
from app.modules.creation.routes import router as creation_router
from app.modules.delivery.library import router as library_router
from app.modules.delivery.plan import router as plan_router
from app.modules.delivery.routes import router as delivery_router
from app.modules.execution.routes import router as execution_router
from app.modules.identity.routes import router as identity_router
from app.modules.identity.team import router as team_router
from app.modules.products.preview import router as product_preview_router
from app.modules.products.routes import router as products_router
from app.modules.prompt_assist.routes import router as assist_router
from app.modules.reviews.routes import router as reviews_router
from app.modules.tasks.routes import router as tasks_router
from app.modules.templates.routes import router as templates_router

from .health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(identity_router)
api_router.include_router(team_router)
api_router.include_router(assets_router)
api_router.include_router(products_router)
api_router.include_router(tasks_router)
api_router.include_router(canvas_router)
api_router.include_router(product_preview_router)
api_router.include_router(cases_router)
api_router.include_router(creation_router)
api_router.include_router(batch_router)
api_router.include_router(execution_router)
api_router.include_router(reviews_router)
api_router.include_router(delivery_router)
api_router.include_router(library_router)
api_router.include_router(plan_router)
api_router.include_router(assist_router)
api_router.include_router(results_router)
api_router.include_router(templates_router)
