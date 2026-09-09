from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from serving_projection.api.routes import router
from serving_projection.metadata.engine import get_engine
from serving_projection.metadata.migrations import run_migrations
from serving_projection.observability.logging import configure_logging


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    run_migrations(get_engine())
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="serving-projection-internal-api", lifespan=lifespan)
    app.include_router(router)

    @app.get("/health/live")
    def health_live() -> dict:
        return {"status": "ok"}

    @app.get("/health/ready")
    def health_ready() -> dict:
        with get_engine().connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        return {"status": "ok"}

    return app


app = create_app()
