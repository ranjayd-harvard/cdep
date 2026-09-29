# Terraform Bootstrap

`infrastructure/terraform/bootstrap` is the one Terraform root in this repository that cannot use
the S3 backend — a brand-new AWS account has no state bucket yet for it to use. It creates that
bucket for every other root (`environments/dev`, `environments/staging`, `environments/production`)
to use as `backend "s3" {}`.

## What it creates

- One S3 bucket (`var.state_bucket_name` — must be globally unique, no safe default, see
  `bootstrap/terraform.tfvars.example`), with versioning, Block Public Access, a bucket policy
  denying non-TLS and non-KMS-encrypted access, and a lifecycle rule expiring noncurrent versions
  after 180 days.
- One customer-managed KMS key (`enable_kms_encryption = true`, the default) encrypting that
  bucket, distinct from the per-environment `modules/kms` keys created later.

## What it deliberately does NOT create

- No DynamoDB table for state locking — this package uses S3 native state locking
  (`use_lockfile = true` in each environment's `backend.<env>.hcl`), a Terraform 1.10+ feature, so
  no second AWS resource/cost is needed just for locks.
- No environment-specific infrastructure (VPC, RDS, ECS, ...) — that's every other root.

## State: this stack uses LOCAL state, by design, on first run

There is no bucket yet for it to store its own state in. Its `.tfstate` file lives on whatever
machine ran `terraform apply` here — treat that file (and `terraform.tfvars`) as sensitive and back
it up somewhere durable (it's small; a private, versioned location is enough — it is not meant to
live in this Git repository).

## Optional: migrating the bootstrap stack's own state into the bucket it created

Once the state bucket exists, you can move this stack's own state into it for consistency (so
every root, including this one, uses remote state):

```bash
cd infrastructure/terraform/bootstrap
# Add an empty `backend "s3" {}` block to versions.tf first, then:
terraform init -migrate-state \
  -backend-config="bucket=<state_bucket_name output>" \
  -backend-config="key=data-product-platform/bootstrap/terraform.tfstate" \
  -backend-config="region=<aws_region>" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
```

This requires adding an empty `backend "s3" {}` block to `bootstrap/versions.tf` first (it is
absent by default, precisely so the stack works with zero pre-existing infrastructure). This step
is optional — leaving bootstrap on local state indefinitely is a legitimate choice, since this stack
changes rarely (create once, touch again only to rotate the KMS key or add a reader ARN).

## Running it

See `docs/aws/new-account-deployment.md` Part B (Steps 7–10) for the full command sequence with
plan review. Phase 12 does not run any of these commands — this document describes what running
them later will do.
