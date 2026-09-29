# Terraform (Phase 12 — AWS Infrastructure as Code)

**Status: NOT DEPLOYED.** This directory is a complete, validated Terraform package ready to
deploy the Customer Data Exchange Platform onto AWS — no AWS resource has been created by writing
it. See `docs/aws/` for architecture, decisions, and the full deployment runbook.

## What does this create?

A single-region AWS deployment of the whole platform: VPC (3-tier subnets across multiple AZs) →
ALB (+ optional CloudFront/WAF) → 10 ECS Fargate services (customer portal, product API, and 8
internal backend services) → 7 RDS PostgreSQL instances → S3 (exchange inbound/outbound, lakehouse,
audit) → Glue Data Catalog + optional EMR Serverless (Bronze/Silver/Gold) → EventBridge/SQS →
CloudWatch observability → AWS Backup. See `docs/aws/architecture.md` for diagrams.

## What does it intentionally NOT create?

- No GCP, no multi-cloud, no EKS, no service mesh, no active-active multi-region.
- No Amazon DocumentDB / Mongo-compatible datastore — the portal's MongoDB has no AWS mapping in
  this phase (see `docs/aws/architecture-decisions.md` #3).
- No container images pushed to ECR, no secret values populated, no DNS delegated — every
  `container_images` entry and `modules/secrets` container is a placeholder until
  `docs/aws/new-account-deployment.md` Parts G/H/I are run for real.
- No `terraform apply` has ever been run against this code by this phase — see the Phase 12 final
  report for exactly what validation *was* run.

## How are modules organized?

```text
infrastructure/terraform/
├── bootstrap/          one-time-per-account: creates the S3 Terraform state bucket
├── modules/             20 reusable modules — see docs/aws/architecture.md "module architecture"
│   ├── networking, security, kms                     (foundation)
│   ├── s3, rds, secrets, iam                          (data + identity)
│   ├── ecr, ecs-cluster, ecs-service                  (compute)
│   ├── alb, cloudfront, waf, route53                  (edge)
│   ├── glue, emr-serverless                           (lakehouse)
│   ├── eventbridge, sqs                               (eventing)
│   └── observability, backup                          (ops)
└── environments/
    ├── dev/            cost-conscious defaults, single NAT, no WAF/CloudFront/EMR by default
    ├── staging/        moderate sizing, WAF + EMR on, CloudFront off
    └── production/     Multi-AZ, per-AZ NAT, WAF+CloudFront+EMR on, vault-locked backups
```

`environments/{dev,staging,production}/main.tf` are **intentionally near-identical** — every module
call is the same across all three. Per-environment behavior comes entirely from that environment's
own `terraform.tfvars` (see each directory's `terraform.tfvars.example`), never from a code fork.
This is deliberate (Phase 12 §5: "do not duplicate entire infrastructure implementations across
environments").

## How do I bootstrap a new AWS account?

`docs/aws/new-account-deployment.md` Parts A–B, in full. Short version:

```bash
cd bootstrap
cp terraform.tfvars.example terraform.tfvars   # edit: state_bucket_name must be globally unique
terraform init
terraform plan -out=bootstrap.tfplan
terraform apply bootstrap.tfplan               # first point anything is created in AWS
```

## How do I deploy dev / staging / production?

```bash
cd environments/dev   # or staging / production
cp backend.dev.hcl.example backend.dev.hcl     # fill in the bucket from the bootstrap output
cp terraform.tfvars.example terraform.tfvars   # fill in region, account id, domain, sizing
terraform init -backend-config=backend.dev.hcl
terraform validate
terraform plan -out=tfplan                     # review — see docs/aws/pre-deployment-checklist.md
terraform apply tfplan
```

Full details, including image build/push and secret population, in
`docs/aws/new-account-deployment.md`.

## How do I change container versions?

Edit `container_images` in that environment's `terraform.tfvars` (map of service key → full ECR
image reference), then `terraform plan -out=app.tfplan && terraform apply app.tfplan`. See
`docs/aws/new-account-deployment.md` Parts H/I.

## Where are secrets stored?

AWS Secrets Manager. `modules/rds` never generates a password itself — every RDS instance uses
`manage_master_user_password = true`, so AWS creates/rotates the credential and Terraform never
sees the plaintext. `modules/secrets` creates empty containers for everything else (OIDC client
secret, `AUTH_SECRET`, SMTP credentials, internal API keys) — real values are populated manually
post-`apply` (`docs/aws/new-account-deployment.md` Part G), never committed or defaulted in
Terraform. See `docs/aws/database.md` for the one real gap this creates (composing `DATABASE_URL`
from the RDS-managed JSON secret) and the two ways to close it.

## How do I inspect outputs?

```bash
terraform output                    # non-sensitive outputs
terraform output -raw rds_endpoints # etc.
terraform output rds_secret_arns    # sensitive — ARNs only, never plaintext
```

## How do I update infrastructure?

Standard Terraform loop: edit `.tf` (in `modules/` for shared behavior, or an environment's
`main.tf`/`terraform.tfvars` for environment-specific behavior) → `terraform plan -out=tfplan` →
review → `terraform apply tfplan`. Never edit state directly except via `terraform state mv/rm`
for a deliberate refactor.

## How do I destroy a non-production environment safely?

`docs/aws/destroy-environment.md` — read it fully before running `terraform plan -destroy`. Several
resources (RDS, S3, the audit bucket's Object Lock, a locked AWS Backup vault) deliberately resist
destruction; that document explains why and how to actually remove them when you mean it.

## How is GCP portability preserved?

`docs/aws/gcp-portability.md` — no GCP code exists, but every AWS choice here is mapped to its GCP
equivalent, and the document explains why business-domain application code stays untouched either
way (all AWS-specific code lives in `infrastructure/terraform/`, never in `src/` or any service
directory).

## Terraform command cheat sheet

```bash
# Static validation only — safe at any time, creates nothing, needs no AWS credentials
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
```

**FUTURE AWS DEPLOYMENT COMMANDS** (not run by Phase 12 — see `docs/aws/new-account-deployment.md`):

```bash
aws sts get-caller-identity
terraform init -backend-config=backend.dev.hcl
terraform validate
terraform plan -out=tfplan
terraform show tfplan
terraform apply tfplan
```

## Full documentation index

See `docs/aws/` — `architecture.md`, `current-state-inventory.md`, `architecture-decisions.md`,
`account-strategy.md`, `terraform-bootstrap.md`, `new-account-deployment.md`,
`pre-deployment-checklist.md`, `destroy-environment.md`, `networking.md`, `iam.md`,
`iam-permission-matrix.md`, `storage.md`, `lakehouse.md`, `database.md`, `compute.md`,
`eventing.md`, `observability.md`, `security.md`, `backup-recovery.md`, `disaster-recovery.md`,
`cost-model.md`, `gcp-portability.md`.
