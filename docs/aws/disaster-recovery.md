# Disaster Recovery

## Scope of what this Terraform provides

This package builds a **single-region** deployment per environment (Phase 12 §52 explicitly
excludes active-active multi-region). Disaster recovery here means: recovering within the same
region after a resource-level failure or operator error, using the backups/versioning described in
`docs/aws/backup-recovery.md` — not surviving a full regional outage.

## Recovery point / recovery time expectations (by environment)

| | dev | staging | production |
|---|---|---|---|
| RDS PITR window | 3 days | 14 days | 30 days |
| RDS Multi-AZ (automatic failover) | no | no | yes |
| AWS Backup vault (independent daily snapshot) | yes (15-day retention: `rds_backup_retention_days * 5`) | yes (70-day) | yes (150-day), vault-locked |
| S3 versioning (all 4 buckets) | yes | yes | yes |
| Terraform state versioning | yes (bootstrap bucket) | yes | yes |

Production's Multi-AZ RDS gives automatic failover to a standby in a different AZ within the same
region on an AZ-level failure — this is the primary DR mechanism for the database tier; it does not
help against a regional outage.

## What is NOT covered

- **Regional failure**: recovering into a second AWS region would mean re-running
  `infrastructure/terraform/environments/production` against that region (the Terraform is
  region-parameterized via `var.aws_region`, so this is possible), restoring RDS from the most
  recent cross-region-replicated snapshot (not configured by default — RDS snapshots are
  region-local unless you add cross-region snapshot copying), and re-pointing DNS. This is a real
  DR exercise to design and test, not something `terraform apply` alone accomplishes.
- **Glue Catalog / Iceberg table corruption**: recovering a corrupted Iceberg table means rolling
  back to a prior snapshot (PyIceberg/Spark operation, not a Terraform or AWS-console operation) —
  see `docs/aws/backup-recovery.md`.
- **Cross-account or cross-region KMS key availability**: `modules/kms` keys are region-local;
  restoring a snapshot into a different region requires a KMS key in that region too.

## Recommended before declaring production DR-ready

1. Perform an actual restore test (RDS snapshot → new instance, verify data) — Phase 12 explicitly
   defers this to post-deployment (§61).
2. Decide whether cross-region snapshot replication is needed for your actual RTO/RPO requirements,
   and add it explicitly (not present by default — would be a small `modules/rds` addition:
   `aws_db_instance_automated_backups_replication` or a scheduled snapshot-copy job).
3. Document and test the DNS cutover procedure if a second region is ever provisioned.

None of the above was performed as part of Phase 12 — this document states requirements and gaps,
not completed work.
