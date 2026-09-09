from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from serving_projection.config.settings import Settings, get_settings


def require_internal_api_key(
    x_internal_api_key: str | None = Header(default=None),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> None:
    """Mirrors data-publication-service's `require_internal_api_key`: an
    unset configured key never matches, header must match exactly. Gates
    this service's ops-only surface (health/projection-run history/manual
    trigger) -- never customer-facing."""
    if not settings.internal_api_key or x_internal_api_key != settings.internal_api_key:
        raise HTTPException(status_code=403, detail="Missing or invalid internal API key.")
