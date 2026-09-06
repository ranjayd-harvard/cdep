from __future__ import annotations

from functools import lru_cache

import sqlalchemy as sa
from sqlalchemy import Engine

from publication.config.settings import get_settings


@lru_cache
def get_engine() -> Engine:
    return sa.create_engine(get_settings().db_url, pool_pre_ping=True)
