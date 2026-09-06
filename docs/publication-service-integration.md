# Phase 4: data-publication-service ↔ data-exchange-service ↔ data-lakehouse

Status as of 2026-09-06: **wired and verified end-to-end** against the
real, running local stack — see `data-publication-service/README.md`
("What was actually verified") for the full list of what was actually
run, not just implemented.

This is the short cross-reference doc; the substantive documentation
lives in each service's own README, following this repo's existing
convention (see `docs/exchange-service-integration.md` for the cdep ↔
data-exchange-service equivalent).

## What closes here

```text
Gold Data Product (data-lakehouse)
      │ GoldReady
      ▼
data-publication-service    -- new repo, this Phase
      │ real Exchange Service handoff (create -> upload -> complete)
      ▼
data-exchange-service       -- extended, not rewritten
      │ OUTBOUND exchange, READY
      ▼
cdep portal Downloads page  -- unchanged; already generic over how an
                                OUTBOUND/READY exchange was produced
```

## Where to look

- **`data-publication-service/README.md`** — the full picture: why
  PyIceberg/PyArrow instead of Spark, the publication contract model,
  tenant scoping + cross-tenant safety assertion, the quality gate,
  idempotency, deployment mapping (AWS/GCP), and the verification log.
- **`data-exchange-service/src/modules/outbound-publications/`** — the
  additive internal API (`POST /internal/v1/outbound-publications`,
  `.../complete`, `.../fail`) this service's `ExchangeServiceClient`
  talks to. Separate from, and does not replace, that service's
  pre-existing `/internal/v1/publications` fixture-content simulator
  (cdep's own upload-triggered demo publish still uses that one).
- **`data-exchange-service/src/tests/integration/outbound-gold-publication.test.ts`**
  — create→upload→complete, idempotent complete, checksum-mismatch →
  `FAILED`, cross-tenant download denial, explicit `/fail`.

## Nothing changed in cdep (the portal)

The portal's Downloads page already calls `GET /v1/exchanges?direction=OUTBOUND&status=READY`
against data-exchange-service (see `docs/exchange-service-integration.md`)
and is generic over how an outbound exchange came to exist. A real
Gold-derived publication shows up there identically to the pre-existing
fixture-content demo publish — confirmed directly against the API during
Phase 4 verification, no portal code touched.
