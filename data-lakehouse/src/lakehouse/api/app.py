from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from lakehouse.api.routes import router
from lakehouse.ingestion.ingestion_runner import build_ingestion_service
from lakehouse.observability.logging import configure_logging


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    # Built once per process and shared across requests -- safe at this
    # admin tool's concurrency level: get_engine()/get_catalog() are
    # already process-wide singletons designed for concurrent use, and
    # structlog.contextvars logging context is per-thread (each request's
    # sync handler runs in Starlette's threadpool).
    app.state.ingestion_service = build_ingestion_service()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="lakehouse-internal-api", lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()
