"""Applies sql/*.sql against the api_serving Postgres, in filename order.
Mirrors data-publication-service's own approach of idempotent
(`CREATE ... IF NOT EXISTS`) migration files rather than a migration
framework.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import Engine, text

from serving_projection.config.settings import REPO_ROOT

SQL_DIR = REPO_ROOT / "sql"


def run_migrations(engine: Engine) -> list[str]:
    applied = []
    for path in sorted(SQL_DIR.glob("*.sql")):
        sql = path.read_text()
        with engine.begin() as conn:
            for statement in _split_statements(sql):
                conn.execute(text(statement))
        applied.append(path.name)
    return applied


def _split_statements(sql: str) -> list[str]:
    return [s.strip() for s in sql.split(";") if s.strip()]


def _cli() -> None:
    import sqlalchemy as sa
    import structlog

    from serving_projection.config.settings import get_settings
    from serving_projection.observability.logging import configure_logging

    configure_logging()
    log = structlog.get_logger(__name__)
    engine = sa.create_engine(get_settings().db_url)
    applied = run_migrations(engine)
    log.info("migrations.applied", files=applied)


if __name__ == "__main__":
    _cli()
