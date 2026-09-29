# Database (RDS PostgreSQL)

Seven RDS PostgreSQL instances, one per service that owns data (see
`docs/aws/architecture-decisions.md` #1/#2 for why this count and not nine or one):
`exchange-service`, `catalog-service`, `subscription-service`, `scheduler-service`,
`publication-service`, `observability-service`, `serving-projection-service`.

## Configuration (`modules/rds`, every instance)

- Private DATA subnets only; `publicly_accessible` is not even a variable — hard-coded `false`.
- `storage_encrypted = true`, KMS (primary key).
- `manage_master_user_password = true` — AWS creates/rotates the credential in Secrets Manager;
  Terraform never sees or stores the plaintext.
- `rds.force_ssl = 1` parameter group setting — the driver must use TLS.
- Automated backups with a configurable retention window and PITR (`backup_retention_period`,
  default 3 days in dev, 30 in production).
- `deletion_protection` on by default outside dev; `skip_final_snapshot = false` outside dev (a
  final snapshot is taken if the instance is ever destroyed).
- Performance Insights enabled by default (7-day retention, free tier).
- Enhanced Monitoring configurable via `monitoring_interval_seconds` (needs `monitoring_role_arn` —
  not wired by default in the environment composition; add an IAM role with the AWS-managed
  `AmazonRDSEnhancedMonitoringRole` policy and pass its ARN if you want this).
- gp3 storage with autoscaling ceiling (`max_allocated_storage`).

## The `DATABASE_URL` gap (read this before Part J of the deployment runbook)

Every service's existing code expects one `DATABASE_URL` connection string. The RDS-managed secret
is JSON (`host`, `port`, `username`, `password`, `dbname`) — composing a single URL string from it
without ever exposing the plaintext to Terraform is not something Terraform itself can do (that
would require Terraform to read the generated password back out, defeating the purpose of
`manage_master_user_password`).

`modules/ecs-service` injects the individual fields as `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/
`PGDATABASE` (ECS `secrets` block, `arn:...:secret:name:jsonkey::` projection) plus a plain
`DATABASE_SECRET_ARN` env var. Two ways to close the gap before running each service's migration
command in `docs/aws/new-account-deployment.md` Part J:

1. **Recommended — a tiny container entrypoint wrapper** (deployment-layer change, not
   business-logic): before `exec`-ing the existing start command, read `DATABASE_SECRET_ARN` via
   the AWS SDK (already available — no new dependency needed beyond what's likely already
   installed, e.g. `@aws-sdk/client-secrets-manager` for the TS services, `boto3` for the Python
   ones), compose `postgresql://user:pass@host:port/db?sslmode=require`, `export DATABASE_URL`,
   then exec. This keeps `manage_master_user_password`'s security property (no plaintext in
   Terraform state) while satisfying the app's existing env var contract unmodified.
2. **Simpler, weaker — a hand-populated `DATABASE_URL` secret**: create one more
   `modules/secrets` entry per service, manually populate it after reading the RDS-managed secret's
   plaintext once via `aws secretsmanager get-secret-value`, and inject that as `DATABASE_URL`
   directly. This reintroduces a manually-managed credential (drifts if RDS ever rotates the
   password) — acceptable for a fast dev bootstrap, not recommended for staging/production.

Neither approach is implemented by this Terraform package — this is a deliberate, documented gap,
not an oversight. Pick one before Part J.

## Multi-AZ and sizing per environment

| | dev | staging | production |
|---|---|---|---|
| Instance class | `db.t4g.micro` | `db.t4g.small` | `db.r6g.large` |
| Multi-AZ | no | no | **yes** |
| Deletion protection | no | yes | yes |
| Backup retention | 3 days | 14 days | 30 days |
| Skip final snapshot | yes | no | no |

Adjust per real workload once traffic data exists — these are starting points, not mandates
(Phase 12 §47).

## Migrations

No ORM, no shared migration framework — every TS service uses hand-written numbered SQL files with
its own `npm run migrate`; `data-publication-service` uses a Python module runner
(`python -m publication.metadata.migrations`); `data-lakehouse` used SQL-file
`docker-entrypoint-initdb.d` mounts (now moot — no RDS instance for it). None of this changes.
`docs/aws/new-account-deployment.md` Part J documents running each service's existing migrate
command as a single, controlled ECS task (not on every replica's startup) against its RDS instance.
