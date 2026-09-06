"""Internal-only HTTP API for the superadmin portal integration.

Not part of the ingestion pipeline's public contract -- every route here is
gated by `x-internal-api-key` (see `auth.py`), mirroring
data-exchange-service's own `requireInternalApiKey` pattern. Nothing in the
CLI (`ingestion_runner.py`) or the ingestion pipeline itself depends on this
package; it is a thin, separate HTTP wrapper around `IngestionService` and
`IngestionRepository`.
"""

from __future__ import annotations
