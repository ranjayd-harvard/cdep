# Production Security Checklist

Run `npm run security:release-gate` from the repo root for the automated version of this checklist. As of this phase, running it locally (correctly, since local dev intentionally runs in dev mode) reports:

```text
CRITICAL FAILURES: 0
HIGH FAILURES:     0
WARNINGS:          2   (PostgreSQL RLS not yet load-bearing; audit coverage partial)
RESULT: PASS (with warnings)
```

## Before deploying to production

- [ ] Every service's `AUTH_MODE=oidc` with real `OIDC_ISSUER_URL`/`OIDC_JWKS_URI`/`OIDC_AUDIENCE` pointing at a production IdP (not Keycloak-local) — boot fails otherwise.
- [ ] Every `INTERNAL_API_TOKEN`/`*_INTERNAL_API_KEY` overridden from its shipped default — boot fails otherwise, but confirm each value is actually a strong, distinct-per-relationship secret, not just "different from the tutorial string."
- [ ] MinIO/Postgres default credentials (`minioadmin`/`minioadmin`, `lakehouse`/`lakehouse123`, etc.) replaced with real, secret-manager-issued credentials.
- [ ] TLS everywhere — this phase did not configure any transport encryption; see [encryption-secrets.md](encryption-secrets.md).
- [ ] Complete the service-identity migration for the ~14 caller/callee relationships still on the legacy static-key path (see [service-identities.md](service-identities.md)) — production already refuses the legacy path per-callee once migrated, but only `subscription-service` has been migrated so far.
- [ ] Decide and implement the PostgreSQL RLS session-variable wiring + least-privilege role cutover for the remaining services, or explicitly accept application-layer filtering as the sole control (see [tenant-isolation.md](tenant-isolation.md)).
- [ ] Add CI dependency/secret/container scanning (`.github/workflows/` is empty today).
- [ ] Decide on `data-product-api-service` and portal audit-trail coverage (currently no security audit table in either).
- [ ] Review and, if desired, replace the portal's dead `cdep_live_...` customer API-key feature (generates/displays keys that authenticate nothing today) or wire it in before shipping it as a real capability.
- [ ] Distributed rate limiting for `data-product-api-service` (today's limiter is in-memory, per-process).

## Already true, verified by this session's tests

- [x] Real JWT verification (signature/issuer/audience/expiry/algorithm) in all 5 customer-facing services.
- [x] RBAC permission matrices replace scattered role checks in all 6 backend services.
- [x] Entitlement re-validated fresh at subscription creation, scheduled dispatch, API query, and FILE publish.
- [x] Mandatory cross-tenant isolation test passes against real running services.
- [x] RESTRICTED-field contracts rejected at registration without a complete governance decision.
- [x] FILE and API delivery enforce identical column policy from one Catalog source of truth.
- [x] Presigned upload size enforced against the real object, not just the declared size.
- [x] Retention/deletion/legal-hold implemented and tested against real object storage.
- [x] Append-only security audit tables in `data-exchange-service` (DB-enforced) and `data-product-catalog-service`.
- [x] Every backend container runs as non-root; every TS service has a container healthcheck.
- [x] Every service fails closed on `AUTH_MODE=development` or a default internal secret in production.
