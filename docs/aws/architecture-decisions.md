# Architecture Decisions

Decisions made while building `infrastructure/terraform/`, in the order a reader would hit them.
Each entry: the decision, why, and what it means for a future deploy. See
`docs/aws/current-state-inventory.md` for the local-state facts these decisions respond to.

## 1. Nine RDS instances, not one shared cluster

Every backend TS/Python service already owns an independent Postgres database locally, with its
own migrations and no cross-service schema access. Terraform preserves that: `modules/rds` is
instantiated once per service via `for_each` in each environment's `main.tf`, not consolidated into
a shared multi-tenant RDS cluster. This keeps blast radius, backup/restore, and IAM scoping
per-service, matching the existing trust-boundary model in `docs/security/trust-boundaries.md`.
Consolidating onto shared clusters later (for cost) is possible without a module rewrite — it's an
environment-composition change, not a `modules/rds` change.

## 2. `data-lakehouse` gets no RDS instance

Locally, `data-lakehouse`'s Postgres is the PyIceberg `SqlCatalog` metadata store — and the code
itself documents this as a placeholder ("swapping to a production catalog e.g. AWS Glue later is a
configuration change here only"). AWS Glue Data Catalog (`modules/glue`) replaces it outright. Only
seven RDS instances exist: exchange, catalog, subscription, scheduler, publication (control-plane
only, not a copy of Gold), observability, serving-projection (which **is** the serving store).

## 3. MongoDB (the portal) has no AWS mapping in this phase — documented gap, not silently solved

The Phase 12 target architecture (as specified) does not depict a portal database at all, and the
service-mapping table has no MongoDB-compatible entry. This Terraform package does **not** create
Amazon DocumentDB or any other Mongo-compatible datastore. If/when the portal needs to run in AWS,
someone must decide: (a) add a `modules/docdb` module (straightforward — DocumentDB's Terraform
shape closely mirrors RDS), or (b) migrate the portal off MongoDB onto one more RDS Postgres
instance (a real, non-trivial application change, not a Terraform change). Do not assume this is
solved — check `infrastructure/terraform/modules/` for a `docdb` directory before believing the
portal's data layer has an AWS target.

## 4. RDS passwords: AWS-managed, never Terraform-managed

Every `modules/rds` instance sets `manage_master_user_password = true` instead of generating a
password with `random_password` or accepting one as a variable. AWS creates and rotates the
credential in Secrets Manager directly; the plaintext password never exists in a `.tf` file, a
variable default, or (beyond the secret's ARN) Terraform state. This is why the `random` provider
does not appear in `versions.tf` anywhere in this repository — nothing here needs it.

**Consequence, documented not hidden:** the RDS-managed secret is JSON
(`host`/`port`/`username`/`password`/`dbname`), while every service's existing `env.ts`/`settings.py`
expects a single `DATABASE_URL` connection string. `modules/ecs-service` injects the individual
fields as `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` (ECS secret projection,
`arn:...:jsonkey::` syntax) plus a plain `DATABASE_SECRET_ARN` env var — but nothing in this repo
composes those into `DATABASE_URL` today. See `docs/aws/database.md` for the two ways to close this
gap before Part J (migrations) of `docs/aws/new-account-deployment.md`. This is a deployment-layer
task (an entrypoint wrapper), not a business-logic change.

## 5. No message broker exists locally — EventBridge/SQS are genuinely new infrastructure

`modules/eventbridge` and `modules/sqs` exist because the architecture requires them, not because
they replace something already built. Every current "queue" (data-exchange-service's
`pipeline_jobs` table, scheduling-service's cron/backoff/dead-letter table) stays exactly as it is;
EventBridge only transports notice of the same domain events these services already represent as
Postgres row states. `scheduling-service`'s own retry/backoff/dead-letter logic is not replaced by
an EventBridge schedule — see `docs/aws/eventing.md`.

## 6. No PySpark exists locally — EMR Serverless is provisioned, not migrated onto

The lakehouse transformations are pure PyIceberg/pyarrow/pandas today, run via CLI scripts or a
FastAPI endpoint. `modules/emr-serverless` provisions an application, execution role, and log group
so these jobs **can** run on EMR Serverless later, gated behind `enable_emr` (default off in dev).
No Spark rewrite happens in this phase, and no job is ever submitted by Terraform.

## 7. `identity-provider` (dev-mode Keycloak) is not deployed to AWS

The local Keycloak is explicitly a stand-in ("standing in for a real OIDC provider"), running in
dev mode with in-memory storage. This Terraform package does not lift-and-shift it into ECS.
Before a staging/production deploy, choose a real IdP path — managed Keycloak on ECS with a real
Postgres backing store (reusing `modules/rds` + `modules/ecs-service`), or an external IdP
(Entra ID, Okta, Auth0). Every backend service already validates tokens via generic OIDC env vars
(`OIDC_ISSUER_URL`/`OIDC_JWKS_URI`/`OIDC_AUDIENCE`), so no application code changes either way —
only the values of those three env vars change. `AUTH_MODE=development` must never be set outside
local Docker Compose; `modules/secrets` treats OIDC configuration as Secrets-Manager-sourced,
never defaulted.

## 8. Ten ECS services, not eight

`modules/ecr`'s "expected repositories" list in the phase brief names 8; this deployment adds two
more the platform actually needs: `lakehouse-service` (the existing FastAPI control-plane API that
triggers/monitors Bronze→Silver→Gold, now backed by EMR Serverless instead of local subprocess
calls) and `serving-projection-service` (its own ops/health API, distinct from the Postgres
`data-product-api-service` reads directly). Both get their own ECR repo, task role, and ECS service
— consistent with "one task role per workload, never a shared platform role."

## 9. ECS Service Connect, added beyond the explicit module list

The phase brief's module list has no service-discovery module, but nothing locally suggests how
internal ECS services should find each other in AWS (there's no message broker, and Fargate tasks
don't get stable IPs). `modules/ecs-cluster` provisions a private DNS Cloud Map namespace and
`modules/ecs-service` wires each service into it via `service_connect_configuration`, so
`catalog-service`, `subscription-service`, etc. are reachable at
`<service-name>.<project>-<env>.internal:<port>` from any other task in the cluster. This is
standard, low-overhead AWS plumbing (not a new architectural layer) and was added because without
it the ten ECS services literally cannot reach each other post-deploy.

## 10. KMS key boundary: two keys, not one-per-resource or one-per-account

`modules/kms` creates a `primary` key (S3 exchange/lakehouse buckets, RDS, Secrets Manager) and a
separate `audit` key (CloudTrail + the audit bucket only), so the audit trail can carry a stricter,
separately administered key policy than day-to-day application data. See `docs/aws/security.md`.

## 11. AWS Backup vault lock defaults to OFF (even in production's example tfvars, the flag is on but reviewed)

An AWS Backup vault lock with no `changeable_for_days` becomes a **permanent** COMPLIANCE-mode lock
the instant it's applied — not even the root user can loosen it before recovery points expire.
`modules/backup` defaults `enable_vault_lock = false` and, when enabled, defaults to a 3-day
GOVERNANCE-mode grace period rather than an immediate permanent lock. Production's
`terraform.tfvars.example` sets `enable_vault_lock = true` as a demonstration of the production
posture, but this is exactly the kind of line `docs/aws/pre-deployment-checklist.md` calls out for
deliberate review before a real `apply` — see `docs/aws/backup-recovery.md`.

## 12. Public RDS is structurally impossible, not just discouraged

`modules/rds` does not expose `publicly_accessible` as a variable at all — it's hard-coded `false`.
`modules/networking`'s private DATA subnets have no route to the internet (no NAT route, no IGW
route), so even a future accidental flip of that (removed) variable would have nowhere to route
through. This is deliberate belt-and-suspenders per Phase 12 §43.

## 13. One environment composition, reused verbatim across dev/staging/production

`environments/{dev,staging,production}/main.tf` are intentionally near-identical — every real
difference (Multi-AZ, NAT topology, WAF/CloudFront/EMR toggles, instance sizes, retention) is a
`terraform.tfvars` value, not a code fork. See `infrastructure/terraform/README.md`.
