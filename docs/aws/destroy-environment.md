# Destroying an Environment Safely

There is no single script in this repository that destroys an environment, deliberately — every
step below requires a human to review a plan first. Never construct a `terraform destroy
-auto-approve` wrapper around this.

## Before you start

Confirm which environment you're targeting (`aws sts get-caller-identity`, the working directory,
`terraform workspace show` if workspaces are in use — this package does not use workspaces, one
directory per environment instead, so confirm you `cd`'d into the right one). Destroying
`environments/production` is categorically different from destroying `environments/dev` — treat it
accordingly.

## What will resist destruction, and why (read before you hit an error)

| Resource | Guard | Why | How to actually remove it |
|---|---|---|---|
| RDS instances (7x) | `deletion_protection` (true outside dev), `prevent_destroy` lifecycle block | Prevent an accidental `terraform destroy` from silently dropping a database | Set `rds_deletion_protection = false` in tfvars, `terraform apply` that change FIRST, then destroy. A final snapshot is taken unless `rds_skip_final_snapshot = true` |
| S3 buckets (4x, + bootstrap state bucket) | `prevent_destroy` lifecycle block; non-empty buckets refuse to delete regardless | Buckets hold customer data, Iceberg tables, or the audit trail / Terraform state itself | Empty the bucket first (`aws s3 rm s3://<bucket> --recursive` — **read the next row before doing this to the audit bucket**), then remove `prevent_destroy` (edit the module or `terraform state rm` + manual delete — see below) |
| Audit bucket specifically | Object Lock (WORM) enabled | Objects under an active retention period **cannot** be deleted even by an account administrator, by design | Wait out the retention period, or (governance-mode objects only, if any exist) use `s3:BypassGovernanceRetention` — never applicable to compliance-mode holds |
| AWS Backup vault | `enable_vault_lock` — if true and in COMPLIANCE mode (no `changeable_for_days`), the vault and its recovery points **cannot** be deleted before the lock's retention expires, full stop | Prevents deletion of backups during an incident, including by a compromised admin credential | There is no override for COMPLIANCE mode — this is intentional. GOVERNANCE mode (the module's default when locking is enabled) can be removed via `aws backup delete-backup-vault-lock-configuration` first |
| KMS keys | 30-day deletion window (default) | Anything encrypted with a deleted key becomes permanently unreadable | `terraform destroy` schedules deletion (doesn't delete immediately) — cancellable within the window via `aws kms cancel-key-deletion` |
| Route 53 hosted zone (if `create_route53_hosted_zone = true`) | Must be empty of any non-NS/SOA records | Deleting a zone that's still delegated (parent domain's NS records still point at it) breaks DNS resolution for anyone still pointed at it | Remove delegation at the registrar first if this was a real public zone, not just a test one |
| Terraform state itself | Never a target of any destroy in this repo | State lives in the bootstrap-created bucket, a separate stack from every environment | See "Destroying the bootstrap stack" below — do this last, if ever |

## Retention / legal hold

Before destroying anything holding customer data (exchange buckets, lakehouse bucket, any RDS
instance), confirm nothing is under an active legal hold or retention obligation per
`docs/security/retention-deletion.md`. This Terraform package has no automated legal-hold check —
that determination is a business/legal one, made before you run `terraform plan -destroy`, not
something Terraform enforces for you.

## Recommended procedure — a non-production environment (dev/staging)

```bash
cd infrastructure/terraform/environments/dev

# 1. Review what would be destroyed — every resource, no exceptions
terraform plan -destroy -out=destroy.tfplan

# 2. Read it. All of it. Specifically look for anything you did not expect to be in this
#    environment (a resource that should have been in staging, for instance).

# 3. Handle the guarded resources above first if they apply to this environment
#    (in dev, deletion_protection/skip_final_snapshot are usually already permissive —
#    check terraform.tfvars before assuming)

# 4. Only then:
terraform apply destroy.tfplan
```

## Recommended procedure — production

Do not run `terraform destroy` against production as a routine operation. If genuinely
decommissioning production:

1. Confirm with whoever owns the business decision — this is not a Terraform-operator decision.
2. Export/verify final backups exist somewhere *outside* this AWS account (a snapshot inside the
   account being destroyed is not a backup of the account being destroyed).
3. Disable `deletion_protection`, `enable_vault_lock` (if in GOVERNANCE mode — COMPLIANCE mode
   cannot be disabled), and any Object Lock retention that has expired, via a reviewed `apply`
   *before* the destroy plan, not as part of it.
4. Follow the non-production procedure above, with more reviewers.
5. After destroy, separately decide whether to also destroy `infrastructure/terraform/bootstrap`
   (see below) — usually not, if other environments still share that state bucket.

## Destroying the bootstrap stack

Only do this if no environment anywhere still uses this state bucket. `prevent_destroy` on the
state bucket resource means you must first remove that lifecycle block (edit
`bootstrap/main.tf`) or use `terraform state rm` + delete manually — both are deliberately
friction-full. Confirm the bucket is truly empty (`aws s3 ls s3://<bucket> --recursive`) and that no
other environment's `backend.*.hcl` still points at it before proceeding.
