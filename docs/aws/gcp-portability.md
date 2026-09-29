# GCP Portability Assessment

No GCP infrastructure is implemented anywhere in this repository. This document is the mapping to
preserve for later, and — more importantly — an assessment of which AWS choices in this Terraform
package could leak AWS-specific assumptions into business-domain code if someone weren't careful.
None currently do; this documents why.

## Service mapping

| AWS (this package) | GCP equivalent | Portability notes |
|---|---|---|
| ECS Fargate | Cloud Run (stateless HTTP services) or GKE (if Service Connect-style internal DNS / long-running workers need it) | Task definitions are plain container images + env vars + secrets — no ECS-specific API surface touches application code |
| S3 | Cloud Storage | Every service already talks to storage through an S3-API-compatible interface (`data-exchange-service`'s `ObjectStorage`, PyIceberg's S3 properties) — GCS's dual-mode S3-compatible XML API means these adapters could work with minimal change; a native GCS adapter would still only touch the existing storage-interface implementation, never callers |
| RDS PostgreSQL | Cloud SQL for PostgreSQL | Same engine (Postgres) — connection-string shape is the only real difference, already isolated behind each service's `DATABASE_URL`/`env.ts` |
| AWS Glue Data Catalog | A compatible Iceberg REST catalog, or BigLake/BigQuery metastore | PyIceberg supports multiple catalog implementations already (local `SqlCatalog` today, Glue in this phase) — swapping catalog implementations was already designed to be configuration-only, per `data-lakehouse`'s own code comment |
| EMR Serverless | Dataproc Serverless | Both run Spark; the PySpark job itself (once it exists — see `docs/aws/lakehouse.md`, no Spark job exists yet) would be portable as-is |
| EventBridge | Eventarc / Pub/Sub | Domain event names/payloads are application-defined, not AWS-shaped; only the transport binding changes |
| SQS | Pub/Sub | At-least-once delivery semantics are equivalent; existing idempotency-key handling already assumes this |
| Secrets Manager | Secret Manager | Both are simple key→versioned-value stores; the `SecretProvider` gap noted in `docs/aws/architecture-decisions.md` means there's no existing app-level abstraction to preserve — either cloud requires the same net-new integration work |
| KMS | Cloud KMS | Both are envelope-encryption key stores fronting the storage/database/secrets services above |
| CloudWatch (Logs/Metrics/Alarms) | Cloud Logging / Cloud Monitoring | `awslogs` driver output is plain stdout/stderr — no AWS-specific log format is required of application code |
| IAM roles (task roles) | IAM service accounts (workload identity) | Both are "assume an identity, get scoped permissions" — no AWS-specific credential code exists in any service (everything uses the ambient SDK credential chain) |
| ALB / CloudFront | Cloud Load Balancing / Cloud CDN | Both terminate TLS and route by path/host; WAF-equivalent is Cloud Armor |
| AWS WAF | Cloud Armor | Rule-set based edge protection either way |

## Where AWS-specific choices are correctly contained

- **Business-domain code**: none of the ten services import an AWS SDK for anything the
  `ObjectStorage`/service-identity abstractions don't already cover, per
  `docs/aws/current-state-inventory.md`'s provider-abstraction survey. The one place this phase
  adds AWS-SDK usage to a container's runtime is the `DATABASE_URL`-composition entrypoint wrapper
  described in `docs/aws/database.md` — that wrapper is explicitly deployment-layer glue, not
  application logic, and its GCP equivalent (reading a Cloud SQL connection via the Cloud SQL Auth
  Proxy or Secret Manager) would replace it symmetrically without touching the services' own code.
- **Terraform**: entirely AWS-provider resources, contained to `infrastructure/terraform/` — no
  application source file references a Terraform-managed resource ARN, bucket name, or role name
  directly; every such value arrives as an environment variable or injected secret at deploy time.
- **Naming/tagging convention** (`{project}-{environment}-{service}-{resource}`): cloud-neutral,
  reusable verbatim for a GCP `modules/` tree if one is ever built.

## What a GCP implementation would actually require (not built here)

A full `infrastructure/terraform-gcp/` (or a Terraform Google-provider variant of today's modules)
following the same module boundaries — this is a real, multi-week engineering effort, explicitly
out of scope for Phase 12 (§51/§52: "Do not implement GCP").
