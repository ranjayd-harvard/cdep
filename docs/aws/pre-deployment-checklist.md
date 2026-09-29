# Pre-Deployment Checklist

Work through this before Part F ("Deploy the foundation") of `docs/aws/new-account-deployment.md`.
Each item names where to verify it.

```text
[ ] Correct AWS account          — `aws sts get-caller-identity` matches the intended account
[ ] Correct AWS profile          — $AWS_PROFILE is the one you think it is
[ ] Correct AWS region           — $AWS_REGION matches terraform.tfvars' aws_region
[ ] Root MFA enabled             — Part A, Step 2
[ ] Administrative identity configured — Part A, Step 3 (SSO/Identity Center, not a root key)
[ ] Terraform backend created    — bootstrap/ applied, state_bucket_name output captured
[ ] State bucket encrypted       — `aws s3api get-bucket-encryption --bucket <state bucket>`
[ ] State bucket versioned       — `aws s3api get-bucket-versioning --bucket <state bucket>`
[ ] State locking enabled        — backend.<env>.hcl has `use_lockfile = true`
[ ] terraform validate passes    — `terraform validate` in the target environment directory
[ ] lint passes                  — `tflint --recursive .` (if installed)
[ ] security scan passes         — `checkov -d . --framework terraform` (if installed)
[ ] plan reviewed                — Part E; specifically re-read the IAM, S3, RDS, security-group
                                    diffs, not just the resource count
[ ] No public RDS                — every `aws_db_instance` in the plan shows
                                    `publicly_accessible = false` (this is hard-coded in
                                    modules/rds — a plan showing anything else means the module
                                    was edited; investigate before proceeding)
[ ] No public S3                 — every bucket's Block Public Access is all-true in the plan
[ ] IAM policies reviewed        — cross-checked against docs/aws/iam-permission-matrix.md; no
                                    `Resource: "*"` on a data-plane action
[ ] NAT/data-transfer costs understood — docs/aws/cost-model.md; confirm single_nat_gateway matches
                                    your cost/reliability tradeoff for this environment
[ ] RDS size reviewed            — rds_instance_class/rds_multi_az match real expected load, not
                                    just copied from another environment's tfvars
[ ] ECS size reviewed            — ecs_cpu/ecs_memory/desired_count/ecs_max_capacity
[ ] Backup configuration reviewed — rds_backup_retention_days, and specifically
                                    enable_vault_lock (see docs/aws/backup-recovery.md — a
                                    COMPLIANCE-mode lock is irreversible; confirm you mean it)
[ ] Domain configuration reviewed — enable_route53_records / acm_certificate_arn_override; the
                                    ALB always terminates TLS, so exactly one of these must resolve
                                    to a real, valid path before apply
[ ] Secrets strategy reviewed    — you know which of docs/aws/database.md's two DATABASE_URL
                                    options you're using, before Part J
```

## The one item worth double-checking even if everything above passes

A `terraform plan` showing a **replacement** (not addition) of an RDS instance, an S3 bucket, or
the Terraform state bucket itself means data loss on apply. Re-read the plan specifically for `-/+`
lines on those resource types before running `terraform apply`, regardless of how many other items
above are green.
