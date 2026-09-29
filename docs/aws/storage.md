# Storage (S3)

`modules/s3` creates four buckets per environment (see `docs/aws/current-state-inventory.md` for
the local-MinIO-to-S3 mapping):

| Bucket | Owner service | Contents |
|---|---|---|
| `{project}-{env}-exchange-inbound-{suffix}` | data-exchange-service | Customer-uploaded files awaiting Bronze ingestion |
| `{project}-{env}-exchange-outbound-{suffix}` | data-exchange-service / data-publication-service | Published artifacts ready for customer download |
| `{project}-{env}-lakehouse-{suffix}` | data-lakehouse / EMR Serverless | Iceberg tables, prefixed `bronze/`, `silver/`, `gold/` |
| `{project}-{env}-audit-{suffix}` | platform (no application service) | S3 access logs, ALB/CloudFront access logs, CloudTrail (see `docs/aws/backup-recovery.md`) |

Every bucket, unconditionally:

- Block Public Access (all four settings)
- `BucketOwnerEnforced` object ownership (ACLs disabled entirely)
- SSE-KMS by default (`primary` key; audit bucket may use the separate `audit` key)
- Versioning enabled
- A bucket policy denying any request without `aws:SecureTransport` or without
  `s3:x-amz-server-side-encryption: aws:kms`
- `abort_incomplete_multipart_upload` after 7 days

Every non-audit bucket ships its S3 access logs into the audit bucket under
`s3-access-logs/<bucket-key>/`.

## Lifecycle policy per bucket

| Bucket | Noncurrent version expiry | Transition | Current-object expiry |
|---|---|---|---|
| exchange-inbound / exchange-outbound | 90 days (default) | Standard-IA at 90 days | none by default — set `expiration_days` per your retention policy (`docs/security/retention-deletion.md` already governs the *application-level* deletion-request flow; this is the storage-layer backstop) |
| lakehouse | 365 days | none | **never** (`expiration_days = null`) — see below |
| audit | 90 days | none | `retention_days * 20` in dev; set explicitly and generously in production |

**The lakehouse bucket is never blanket-expired.** Iceberg's own metadata (manifest lists, manifest
files) references specific data file versions; an S3 lifecycle rule that expires "old" objects by
age has no way to know whether a file is still referenced by a live snapshot. Real cleanup is
Iceberg's own snapshot-expiration/orphan-file-cleanup maintenance (see `docs/aws/lakehouse.md`
§Iceberg maintenance), which understands the actual reference graph. Do not add a blanket
expiration rule to this bucket without first confirming it only targets files Iceberg maintenance
has already deemed orphaned.

## Naming and uniqueness

Bucket names are `{name_prefix}-{bucket-key}-{bucket_suffix}` — `bucket_suffix` is a Terraform
variable (`var.aws_account_id` by convention, see `terraform.tfvars.example`), never a
Terraform-generated random value, so bucket names are predictable across plans and match what
`docs/aws/new-account-deployment.md` tells an operator to expect.
