from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from lakehouse.config.settings import Settings, get_settings


def require_internal_api_key(
    x_internal_api_key: str | None = Header(default=None),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> None:
    """Mirrors data-exchange-service's `requireInternalApiKey` middleware:
    an unset configured key never matches (no accidental open-auth), and
    the header must match exactly."""
    if not settings.internal_api_key or x_internal_api_key != settings.internal_api_key:
        raise HTTPException(status_code=403, detail="Missing or invalid internal API key.")
