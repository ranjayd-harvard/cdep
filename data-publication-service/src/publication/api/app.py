from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from publication.api.routes import router
from publication.config.settings import get_settings
from publication.exchange.client import ExchangeServiceClient
from publication.metadata.engine import get_engine
from publication.metadata.migrations import run_migrations
from publication.metadata.repository import PublicationRepository
from publication.observability.logging import configure_logging
from publication.services.publication_service import PublicationService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    settings = get_settings()
    engine = get_engine()
    run_migrations(engine)
    # Built once per process and shared across requests -- same rationale
    # as data-lakehouse's api/app.py: get_engine()/get_catalog() are
    # already process-wide singletons designed for concurrent use at this
    # admin-tool concurrency level.
    app.state.publication_service = PublicationService(
        settings=settings,
        repository=PublicationRepository(engine),
        exchange_client=ExchangeServiceClient(settings),
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="publication-internal-api", lifespan=lifespan)
    app.include_router(router)

    @app.get("/health/live")
    def health_live() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
