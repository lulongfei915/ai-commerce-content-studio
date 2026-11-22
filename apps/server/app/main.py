from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api.router import api_router
from .shared.config import get_settings
from .shared.logging import configure_logging


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging(get_settings())
    yield


settings = get_settings()
app = FastAPI(title="造物 Studio API", version="0.1.0", lifespan=lifespan)
app.include_router(api_router, prefix=settings.api_prefix)
