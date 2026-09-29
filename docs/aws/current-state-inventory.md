# Current-State Inventory (Local Platform → AWS Mapping)

This is the Phase 12 baseline: what exists today, service by service, and how each local
dependency is expected to map onto AWS. It is a snapshot as of this writing — re-derive from the
code (`AGENTS.md`, each service's `src/config/env.ts` / `settings.py`, its `Dockerfile`,
`docker-compose.yml`) rather than trusting this file once the platform has moved on.

No AWS resources exist yet. This document only informs the Terraform in `infrastructure/terraform/`.

## Services

| Service | Language/Framework | Container port | Health endpoint | Datastore(s) | ECS placement |
|---|---|---|---|---|---|
| `cdep` (customer portal) | Next.js 16 / React 19, TS | 3000 | `GET /api/health` (no dependency checks) | MongoDB | public (behind ALB) |
| `data-exchange-service` | Fastify 5, TS | 8080 | `/health/live`, `/health/ready` (DB + object storage) | Postgres | internal |
| `data-lakehouse` | Python 3.11, FastAPI + PyIceberg + pyarrow | 8000 (host 8090) | `/health/live` | Postgres (Iceberg SQL catalog) + S3/MinIO (Bronze/Silver/Gold) | internal + EMR Serverless jobs |
| `data-platform-observability-service` | Fastify 5, TS | 8097 | `/health/live`, `/health/ready` | Postgres | internal |
| `data-product-api-service` | Fastify 5, TS | 8095 | `/health/live`, `/health/ready` | none of its own — reads serving-projection-service's Postgres directly | public (behind ALB) |
| `data-product-catalog-service` | Fastify 5, TS | 8092 | `/health/live`, `/health/ready` | Postgres | internal |
| `data-publication-service` | Python 3.11, FastAPI + PyIceberg | 8000 (host 8091) | `/health/live` | own Postgres (control-plane) + reads lakehouse's Iceberg/Postgres | internal + EMR Serverless jobs |
| `scheduling-service` | Fastify 5, TS (`cron-parser`) | 8094 | `/health/live`, `/health/ready` | Postgres | internal |
| `subscription-service` | Fastify 5, TS | 8093 | `/health/live`, `/health/ready` | Postgres | internal |
| `serving-projection-service` | Python 3.11, FastAPI + PyIceberg | 8000 (host 8096) | `/health/live`, `/health/ready` | own Postgres — **is** the API serving store | internal + EMR Serverless jobs |
| `identity-provider` | Keycloak 26.0 | 8080 (host 8180) | Keycloak `/health/ready` | in-memory (dev mode) | not carried to AWS as-is — see [Identity](#identity--oidc) |

Only `cdep` and `data-product-api-service` are reachable from the ALB. Every other service is
internal-only, matching the security-group boundary in `modules/security`.

## Datastores

Nine independent Postgres databases exist locally (one per backend service, each with its own
migrations, no shared schema), plus one MongoDB (portal only). **Every backend Postgres maps to
its own RDS PostgreSQL instance** (or, in later phases, could be consolidated onto shared clusters
per environment cost target — Terraform here provisions one `rds` module call per service so that
choice stays reversible).

**Gap — MongoDB is not in the Phase 12 AWS target architecture.** The portal's MongoDB user/org/
tenant directory has no AWS mapping in this phase's required architecture (the target diagram in
the phase brief does not depict a portal database). Amazon DocumentDB (MongoDB-compatible) is the
natural AWS home for it, but building a `docdb` module is out of scope for this phase's explicit
module list. This is tracked as a deferred decision in `docs/aws/architecture-decisions.md` —
do not assume it is silently solved by the `rds` module, which is PostgreSQL-only.

## Object storage

`data-exchange-service` already has a portable `ObjectStorage` interface
(`src/storage/storage.interface.ts`) backed by `@aws-sdk/client-s3` against MinIO — pointing it at
real S3 is a configuration change (endpoint, credentials, region), not a code change. The same is
true of `data-lakehouse`'s PyIceberg `SqlCatalog` S3 properties. Four logical buckets exist across
local MinIO instances and map 1:1 to the `s3` Terraform module's four buckets:

| Local bucket (MinIO) | AWS bucket (Terraform) |
|---|---|
| `exchange-inbound` (data-exchange-service) | `{project}-{env}-exchange-inbound` |
| `exchange-outbound` (data-exchange-service) | `{project}-{env}-exchange-outbound` |
| `lakehouse-bronze` / `lakehouse-silver` / `lakehouse-gold` (data-lakehouse) | `{project}-{env}-lakehouse` (single bucket, prefixed `bronze/`, `silver/`, `gold/` — matches how Iceberg already partitions by table, not by bucket) |
| — (no local equivalent) | `{project}-{env}-audit` (new — CloudTrail + S3 access logs + audit exports) |

## Lakehouse / Iceberg

- Catalog: PyIceberg `SqlCatalog`, metadata in Postgres, explicitly documented in-repo as
  "swapping to a production catalog (e.g. AWS Glue) later is a configuration change here only." →
  maps directly to the `glue` module (AWS Glue Data Catalog as the Iceberg catalog implementation).
- No PySpark exists anywhere in the codebase — transformations are pure PyIceberg/pyarrow/pandas,
  invoked via CLI scripts or a FastAPI endpoint, not a cluster scheduler. **EMR Serverless is
  therefore new infrastructure, not a lift-and-shift of an existing Spark job** — the `emr-serverless`
  module provisions the application/execution role/network config so these existing Python jobs
  *can* run there later, but no Spark rewrite happens in this phase (per the phase's explicit
  "do not rewrite Spark transformations" instruction — read as "do not rewrite the pipeline logic").
- Bronze/Silver/Gold partitioning: Bronze by tenant + ingestion day, Silver/Gold by tenant + date
  month. Preserved as-is; only the physical storage/catalog backend changes.

## Event/queue interfaces

**No message broker exists anywhere in the platform today.** Every "queue" is an in-process,
DB-backed polling loop:

- `data-exchange-service`: `pipeline_jobs` Postgres table + a poll-loop worker driving
  Bronze→Silver→Gold→Publish by calling sibling HTTP APIs.
- `scheduling-service`: in-process cron evaluation (`cron-parser`) + retry/backoff + a dead-letter
  Postgres table (`scheduler_dead_letter`).
- `data-platform-observability-service`: polls all six sibling HTTP APIs on independent intervals
  to build its correlated read model.

The `eventbridge` and `sqs` modules are therefore genuinely new infrastructure. Per the phase
brief's scheduler-responsibility rule, EventBridge/SQS become a transport layer for the same
domain events these services already emit as Postgres rows — they do not replace
`scheduling-service`'s cron/backoff logic, and the authoritative job state stays in each service's
own Postgres table.

## Identity / OIDC

- The portal (`cdep`) does **not** use Keycloak — it has its own Auth.js (NextAuth) v5 session,
  Credentials + Google OAuth, backed by MongoDB. This does not change in Phase 12.
- Every backend TS service (`data-exchange-service`, catalog, subscription, scheduling,
  observability, product-api) validates tokens via generic OIDC env vars: `OIDC_ISSUER_URL`,
  `OIDC_JWKS_URI`, `OIDC_AUDIENCE` — no Keycloak-specific SDK anywhere. `AUTH_MODE=development`
  (unsigned dev tokens) must never reach an AWS environment; Terraform/ECS task definitions treat
  `OIDC_ISSUER_URL`/`OIDC_JWKS_URI`/`OIDC_AUDIENCE` as required Secrets Manager–or–SSM-sourced
  values for staging/production, never defaulted.
- `identity-provider` (local Keycloak, dev-mode, in-memory) is a **stand-in** for a real OIDC
  provider per `AGENTS.md`. It is not deployed to AWS by this Terraform — see
  `docs/aws/architecture-decisions.md` for the decision to require a real IdP (managed Keycloak on
  ECS, or Entra/Okta/Auth0) to be chosen before a staging/production deployment, and to treat this
  as a documented gap rather than silently deploying a dev-mode identity provider into AWS.
- Every service also mints/verifies its own short-lived HS256 "service JWT" for service-to-service
  calls (`src/security/service-identity.ts`, duplicated across the six TS services) — this is a
  de facto `ServiceIdentityProvider`. It maps onto IAM task roles for AWS-level identity (network
  path, resource access) but the application-level service JWT mechanism itself is unchanged by
  this phase; it is out of scope to replace it with IAM SigV4 between services.

## Provider abstractions — what already exists vs. what Phase 12 must introduce

| Abstraction | Exists in code today? | AWS Terraform/deployment mapping |
|---|---|---|
| `ObjectStorageProvider` | Yes (as `ObjectStorage` interface, `data-exchange-service`) — real, portable | S3 (`modules/s3`); no app code change expected, only env var values |
| `SecretProvider` | **No.** `docs/security/encryption-secrets.md` states explicitly this was never implemented — every service reads plain env vars | Introduced net-new at the deployment layer: `modules/secrets` creates Secrets Manager containers; ECS task definitions inject them as container secrets (env var name unchanged, source becomes Secrets Manager) |
| `KeyProvider` | No | `modules/kms` — used by S3/RDS/Secrets Manager encryption; no application-level key-management code exists or is added |
| `ServiceIdentityProvider` | Partially — app-level service JWTs exist; no IAM-based equivalent | `modules/iam` — one task role per service (§ IAM Permission Matrix) |
| `MetricsProvider` | No — `data-platform-observability-service` is a bespoke poller/read-model, not a metrics exporter | `modules/observability` — CloudWatch Logs/Metrics/Alarms; no OpenTelemetry SDK exists in the codebase to wire up yet, tracked as future work |

Business-domain code is not modified by this phase. Every mapping above is a deployment-layer
(Terraform + container env/secrets) change only.

## Databases and migrations

Every TS service uses raw `pg` (no ORM) with hand-written, numbered SQL migration files and its
own `npm run migrate` script — no shared migration framework. The Python services use either a
Python-module migration runner (`data-publication-service`: `python -m publication.metadata.migrations`)
or SQL files mounted as Postgres `docker-entrypoint-initdb.d` (`data-lakehouse`). None of this
changes in Phase 12; `docs/aws/new-account-deployment.md` Part J documents running each service's
existing migration command once, from a single controlled ECS task, against its RDS instance —
not rewriting migrations to a new framework.

## CI/CD

No `.github/workflows` or other CI configuration exists anywhere in the repository today.
Container build/push (`docs/aws/new-account-deployment.md` Part H) is documented as a manual/
scripted step for this phase; wiring it into a CI pipeline is future work, not part of Phase 12.

## Root orchestration (`platform/`)

`platform/start.sh`/`stop.sh`/`restart.sh`/`rebuild.sh`/`platform-init.sh` discover and drive every
service's independent `docker-compose.yml` (generic depth-1 discovery, no manifest). This is
local-only tooling; it has no AWS equivalent and is not touched by this phase. Note for later
phases: `platform-init.sh`'s default reset list (`cdep`, `data-exchange-service`,
`data-lakehouse`) predates several newer services and is already stale for local use — irrelevant
to AWS readiness, but worth fixing separately.

## What this inventory does NOT cover

Per the Phase 12 scope boundary, this document does not attempt to size RDS instances, size ECS
tasks, or decide NAT/CloudFront/WAF defaults per environment — those are variables in
`environments/{dev,staging,production}/terraform.tfvars.example`, chosen for cost/reliability
trade-offs, not derived from local resource usage (local Docker Compose has no meaningful
production sizing signal).
