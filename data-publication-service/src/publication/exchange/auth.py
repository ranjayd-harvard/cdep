"""Service-to-service auth (AGENTS.md section 54).

Local development: a static internal API key, sent as `x-internal-api-key`
-- identical mechanism to data-lakehouse's own `exchange_client=http` path
(`LAKEHOUSE_EXCHANGE_SERVICE_API_KEY` there, `PUBLICATION_EXCHANGE_SERVICE_API_KEY`
here) and to data-exchange-service's own `requireInternalApiKey` middleware.
Never hard-coded -- always read from Settings, which reads it from the
environment.

Production architecture (do not implement here, see README "Deployment
mapping"):
  AWS: workload identity / IAM role-based SigV4 auth between services, or
       short-lived STS-issued service credentials.
  GCP: a service account + Workload Identity Federation, with the internal
       endpoint verifying a Google-signed identity token instead of a
       static key.
"""

from __future__ import annotations

from publication.config.settings import Settings


def internal_auth_headers(settings: Settings) -> dict[str, str]:
    return {"x-internal-api-key": settings.exchange_service_api_key}
