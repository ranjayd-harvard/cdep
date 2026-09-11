# Encryption & Secrets

## Current state — honest status

**No `SecretProvider` or `KeyProvider` abstraction was implemented this phase.** Every service continues to read secrets as plain environment variables via its existing zod-validated `env.ts` (`INTERNAL_API_TOKEN`, `OBJECT_STORAGE_SECRET_KEY`, database passwords, etc.) — the same pattern used since Phase 1. This is the largest deliberate gap in Phase 11: the spec's §26/§27 items (KeyProvider, SecretProvider) were not built, in favor of prioritizing the controls with concrete, testable security properties (JWT verification, RBAC, service identity, retention/legal-hold, governance metadata) within this pass's time.

## What does exist

- **Fail-closed validation at boot**: every service's `env.ts` already refuses to start if `AUTH_MODE=development` when `NODE_ENV=production`, and — new this phase — if any internal-API-key-shaped secret (`INTERNAL_API_TOKEN`, `INTERNAL_API_KEY`, every `<SERVICE>_INTERNAL_API_KEY`) still equals its shipped default value when `NODE_ENV=production`. This is *secret validation*, not secret *management* — it stops the worst failure mode (deploying with the tutorial default) without providing rotation, encryption-at-rest for the secret store, or centralized issuance.
- **No secrets in git**: confirmed `.env`/`.env.local` are gitignored and not tracked; `.env.example` files document required variables without live values.
- **Logs already redact secrets**: every service's pino logger redacts `authorization`, `*.jwt`, `*.token`, `*.signedUrl`/`*.downloadUrl`/`*.uploadUrl` — predates Phase 11, unaffected by it.
- **TLS/encryption at rest**: not configured anywhere in this local Docker Compose setup (Postgres, MinIO, and inter-service HTTP all run unencrypted locally) — appropriate for local dev, a hard requirement for Phase 12's cloud deployment, not something this phase attempted to retrofit into Docker Compose.

## Phase 12 mapping (not implemented, planned only)

```text
SecretProvider
    local:  env vars (current)
    AWS:    Secrets Manager
    GCP:    Secret Manager

KeyProvider
    local:  none
    AWS:    KMS
    GCP:    Cloud KMS

Encryption in transit
    local:  unencrypted (Docker bridge network only)
    cloud:  TLS everywhere — ALB/API Gateway termination, service mesh mTLS
            or VPC-internal TLS between services, TLS to managed Postgres/S3

Encryption at rest
    local:  none (MinIO/Postgres default, unencrypted volumes)
    cloud:  RDS/Cloud SQL encryption at rest, S3/Cloud Storage default
            encryption, EBS/PD volume encryption
```

## Recommendation for whoever picks this up next

Implement `SecretProvider` as a small interface (`get(name): Promise<string>`) with an env-var-backed implementation for local dev (today's behavior, made explicit behind the interface) and note in each service's `env.ts` which fields should route through it in production — this is a bounded, mechanical follow-up, not a redesign.
