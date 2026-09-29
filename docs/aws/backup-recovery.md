# Backup & Recovery

## RDS: two independent layers

1. **RDS's own automated backups** (`modules/rds`): `backup_retention_period` (3/14/30 days by
   environment) + point-in-time recovery, `backup_window`/`maintenance_window` set to non-overlapping
   off-peak UTC windows.
2. **AWS Backup** (`modules/backup`): a separate vault + daily plan (`schedule_cron`, default
   05:00 UTC) targeting every RDS instance's ARN, with its own lifecycle
   (`cold_storage_after_days`/`delete_after_days`, default 35 in dev, `rds_backup_retention_days * 5`
   generally). This gives a second, independently-schedulable recovery point in a separate vault —
   useful if RDS's own automated backup window is ever compromised or misconfigured.

## Vault lock — read before enabling

`enable_vault_lock` defaults to **false**. An AWS Backup vault lock applied with no
`changeable_for_days` becomes a **permanent COMPLIANCE-mode lock instantly** — not even the root
user can remove or loosen it before every recovery point's retention expires. When you do enable
it, `vault_lock_changeable_for_days` (default 3) keeps it in GOVERNANCE mode with a grace period
first. Production's `terraform.tfvars.example` sets `enable_vault_lock = true` as a demonstration
of the intended production posture — treat flipping this on as a deliberate, reviewed decision
(`docs/aws/pre-deployment-checklist.md`), not something to accept from a default.

## S3 versioning

Every bucket has versioning enabled (`modules/s3`). The audit bucket additionally has Object Lock
enabled (WORM) — once populated, audit objects cannot be deleted or overwritten even by an account
administrator until their retention period (set at write time) expires.

## Terraform state

The bootstrap-created state bucket has versioning + a lifecycle rule expiring noncurrent versions
after 180 days — a bad `apply`'s state is recoverable by restoring the previous S3 object version,
not just by re-running `terraform refresh` against reality.

## S3/Iceberg recovery considerations

Restoring an Iceberg table to a prior state is a snapshot-rollback operation (`RollbackToSnapshot`
in PyIceberg / Spark), not an S3-versioning restore — S3 versioning protects individual object
overwrites/deletes, but a consistent *table* rollback needs Iceberg's own snapshot history, which
depends on the Glue Catalog's metadata pointer history being intact. Back up Glue Catalog metadata
awareness accordingly: Glue itself doesn't need a separate backup mechanism (it's a managed,
durable AWS service), but a `DeleteTable` on a Glue database is not something S3 versioning
protects against — least-privilege IAM is the real protection here. Only `lakehouse-job-role` (the
EMR Serverless execution role, `modules/emr-serverless`) is granted `glue:DeleteTable`, and only
against this project's own three databases; every other role in
`docs/aws/iam-permission-matrix.md` has read-only or no Glue access at all.

## What Phase 12 does NOT do

No restore test, no actual snapshot taken, no vault created — this document describes what the
Terraform, once applied, is capable of. Schedule a real restore test as a post-deployment activity
(Phase 12 §61 explicitly defers this).
