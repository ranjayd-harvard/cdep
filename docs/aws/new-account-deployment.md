# New AWS Account Deployment Runbook

Step-by-step instructions for taking `infrastructure/terraform/` and deploying it into a **new**
AWS account, later. Nothing in this document has been executed — Phase 12 built the Terraform and
this runbook only; see the Phase 12 final report for what was actually run (`fmt`/`init -backend=
false`/`validate`, no `apply`, no AWS resources created).

Read `docs/aws/pre-deployment-checklist.md` alongside this and complete it before Part F (deploy).

---

## Part A — New AWS account preparation

### Step 1 — Create or select the AWS account

Record, outside of Git: AWS Account ID, AWS Region, environment name (dev/staging/production). See
`docs/aws/account-strategy.md` for whether this should be a fresh account or a shared one. Do not
place the real account ID in any committed file — every `terraform.tfvars`/`backend.*.hcl` is
gitignored precisely so this is safe to fill in locally.

### Step 2 — Secure the root account

Before anything else: enable MFA on the root user, confirm the root recovery email/phone are
correct, do **not** create root access keys, and stop using root for day-to-day work after this
step. This is a manual AWS Console action, not something Terraform can do.

### Step 3 — Configure administrative access

Prefer AWS IAM Identity Center (or another SSO-based role mechanism) over long-lived IAM users.
Create an administrator permission set for the person(s) running the bootstrap/first apply.
Anything that later automates deployment (CI/CD) should use its own scoped role — not this one.

### Step 4 — Install tooling

```text
AWS CLI v2        https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
Terraform >= 1.10 https://developer.hashicorp.com/terraform/install  (required_version in every
                   versions.tf in this repo — S3 native state locking needs 1.10+)
Git
Docker            (to build the ten service images)
jq                (optional, convenient for reading `terraform output -json`)
```

### Step 5 — Configure AWS CLI

```bash
aws configure sso   # or your organization's preferred secure credential flow
aws sts get-caller-identity
```

Confirm the `Account`, `Arn`, and `UserId` in the output are what you expect **before** proceeding.
Never place a secret access key inside any Terraform file.

### Step 6 — Select the AWS region

```bash
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PROFILE=<your-profile-name>
```

Use this region consistently — it must match `aws_region` in every `terraform.tfvars` below.

---

## Part B — Bootstrap Terraform state

### Step 7 — Configure bootstrap variables

```bash
cd infrastructure/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars
# edit: project_name, environment, aws_region, state_bucket_name (globally unique!)
```

### Step 8 — Initialize

```bash
terraform init
terraform fmt -check
terraform validate
```

### Step 9 — Review the plan

```bash
terraform plan -out=bootstrap.tfplan
```

Expect: one S3 bucket, one KMS key + alias, one bucket policy, public-access-block, versioning,
lifecycle, ownership-controls resources. Nothing else. If you see anything beyond
state-infrastructure, stop and re-read `bootstrap/main.tf` before proceeding.

### Step 10 — Create the backend

```bash
terraform apply bootstrap.tfplan
```

This is the first point at which anything is created in AWS. Do not run this from an unattended
script — it's a one-time, deliberate, human-reviewed action per account.

```bash
terraform output   # note state_bucket_name and aws_account_id
```

---

## Part C — Configure remote state for an environment

### Step 11

```bash
cd ../environments/dev   # or staging / production
cp backend.dev.hcl.example backend.dev.hcl
# fill in: bucket = <state_bucket_name from Step 10>, region, key stays as-is
```

`backend.*.hcl` is gitignored — it contains an account-specific bucket name.

---

## Part D — Configure the environment

### Step 12–13

```bash
cp terraform.tfvars.example terraform.tfvars
# fill in: aws_region, aws_account_id, domain_name (or leave null — see below),
#          acm_certificate_arn_override (required if enable_route53_records=false —
#          the ALB always terminates TLS, see docs/aws/pre-deployment-checklist.md),
#          sizing/feature flags as needed
```

### Step 14 — Initialize with the real backend

```bash
terraform init -backend-config=backend.dev.hcl
```

### Step 15 — Validate

```bash
terraform fmt -check -recursive
terraform validate
tflint --recursive .          # if installed — see docs/aws/security.md
checkov -d . --framework terraform   # if installed
```

---

## Part E — Review the infrastructure

### Step 16–17

```bash
terraform plan -out=tfplan
```

Review specifically: IAM policies (no `Resource: "*"` on a data-plane action —
cross-check `docs/aws/iam-permission-matrix.md`), any public IP exposure, security group rules,
S3/RDS public-access settings (should always show `false`/blocked), KMS key policies, subnet/route
table changes, NAT gateway count, CloudFront/WAF presence, ECS desired counts, RDS instance class,
EMR Serverless config, total resource count, and anything AWS Cost Explorer would flag as
high-cost. Confirm no unexpected **replacement** (not just addition) of RDS, S3, or other
stateful resources — a replace of an S3 bucket or RDS instance means data loss.

---

## Part F — Deploy the foundation

### Step 18

```bash
terraform apply tfplan
```

### Step 19

```bash
terraform output
```

Capture: ECR repository URLs, S3 bucket names, ECS cluster name, RDS endpoints, ALB DNS name,
CloudFront domain (if enabled), Glue database names.

---

## Part G — Populate secrets

### Step 20

`modules/secrets` created empty containers. Populate the real values now:

```bash
aws secretsmanager put-secret-value --secret-id dpp-dev/portal/auth-secret \
  --secret-string "$(npx auth secret)"
aws secretsmanager put-secret-value --secret-id dpp-dev/portal/google-oauth-client-secret \
  --secret-string '<your Google OAuth client secret>'
aws secretsmanager put-secret-value --secret-id dpp-dev/identity/oidc-client-secret \
  --secret-string '<your chosen OIDC provider client secret — see architecture-decisions.md #7>'
aws secretsmanager put-secret-value --secret-id dpp-dev/product-api/cursor-signing-secret \
  --secret-string "$(openssl rand -hex 32)"
# ... one per entry in modules/secrets `secrets` map for this environment
```

RDS credentials need no manual step — `manage_master_user_password = true` already populated them.
Before deploying application images, resolve the `DATABASE_URL` composition gap
(`docs/aws/database.md`) — pick approach 1 or 2 there.

---

## Part H — Build application images

### Step 21

```bash
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin \
  "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com"
```

### Step 22 — Build (repeat per service)

```bash
docker build -t dpp-dev-exchange-service:1.0.0 ./data-exchange-service
docker build -t dpp-dev-customer-portal:1.0.0 .
docker build -t dpp-dev-lakehouse-service:1.0.0 ./data-lakehouse
# ... catalog-service, subscription-service, scheduler-service (from scheduling-service/),
#     publication-service (from data-publication-service/), product-api-service,
#     observability-service (from data-platform-observability-service/),
#     serving-projection-service
```

Never use uncontrolled `:latest` for anything beyond local iteration — tag with a real version.

### Step 23 — Push

```bash
docker tag dpp-dev-exchange-service:1.0.0 \
  "<account-id>.dkr.ecr.$AWS_REGION.amazonaws.com/dpp-dev-exchange-service:1.0.0"
docker push "<account-id>.dkr.ecr.$AWS_REGION.amazonaws.com/dpp-dev-exchange-service:1.0.0"
# repeat per service; record each image digest (`docker inspect --format='{{index .RepoDigests 0}}'`)
```

---

## Part I — Deploy application task definitions

### Step 24

Update `container_images` in `terraform.tfvars` with the real, pushed image references (tag or, for
stronger reproducibility, digest), then:

```bash
terraform plan -out=app.tfplan
terraform apply app.tfplan
```

---

## Part J — Database initialization

### Step 25 — Verify RDS

```bash
terraform output rds_endpoints
aws rds describe-db-instances --db-instance-identifier dpp-dev-exchange-service \
  --query 'DBInstances[0].{Public:PubliclyAccessible,SSL:CACertificateIdentifier,Status:DBInstanceStatus}'
```

Confirm `Public: false`.

### Step 26 — Run migrations, once, in a controlled way

Do **not** let every ECS replica run its migration on startup. Run one-off ECS tasks instead:

```bash
aws ecs run-task \
  --cluster dpp-dev-cluster \
  --task-definition dpp-dev-exchange-service \
  --overrides '{"containerOverrides":[{"name":"exchange-service","command":["npm","run","migrate"]}]}' \
  --launch-type FARGATE \
  --network-configuration '{"awsvpcConfiguration":{"subnets":["<private-app-subnet-id>"],"securityGroups":["<ecs-internal-sg-id>"]}}'
```

Verify success (check the task's CloudWatch log group) before deploying the long-running service
that depends on that schema. Repeat per service that has its own migration command (see
`docs/aws/current-state-inventory.md` §"Databases and migrations" — commands differ: TS services
use `npm run migrate`, `data-publication-service` uses `python -m publication.metadata.migrations`).

---

## Part K — DNS and TLS

### Step 27

If `enable_route53_records = true` and `create_route53_hosted_zone = true`:

```bash
terraform output    # note the new hosted zone's name servers
```

Delegate the parent domain to those name servers with your registrar. If using an existing hosted
zone (`create_route53_hosted_zone = false`), confirm `route53_hosted_zone_id` is correct and that
DNS validation records for the ACM certificate appear and validate (`aws acm describe-certificate`).
If DNS is managed externally (no Route 53 at all — `enable_route53_records = false`), you must
supply `acm_certificate_arn_override` with a certificate validated out-of-band, and create your own
CNAME/A record pointing at `terraform output alb_dns_name` (or the CloudFront domain).

---

## Part L — Lakehouse

### Step 28–30

```bash
terraform output lakehouse_bucket_name
terraform output glue_database_names
aws glue get-database --name dpp_dev_bronze
aws glue get-database --name dpp_dev_silver
aws glue get-database --name dpp_dev_gold
```

If `enable_emr = true`:

```bash
terraform output emr_serverless_application_id
aws emr-serverless get-application --application-id <id>
```

Do not run production data through it until the job/config has been reviewed (see
`docs/aws/lakehouse.md` — no PySpark job exists yet; this only confirms the application itself is
ready to accept one).

---

## Part M — Application verification

### Step 31–33

```bash
aws ecs describe-services --cluster dpp-dev-cluster --services dpp-dev-customer-portal \
  --query 'services[0].{Running:runningCount,Desired:desiredCount,Events:events[0:3]}'
```

Check target group health:

```bash
aws elbv2 describe-target-health --target-group-arn <from terraform output or console>
```

Hit the public endpoint:

```bash
curl -sSf "https://$(terraform output -raw alb_dns_name)/api/health"
```

Verify OIDC: confirm the identity provider chosen in Part G issues tokens with the issuer/audience
values that match `OIDC_ISSUER_URL`/`OIDC_AUDIENCE` on every backend service, and that callback
URLs are registered against the real ALB/CloudFront domain, not `localhost`.

---

## Part N — Data flow test

### Step 34

Exercise one end-to-end flow through the real deployment: upload → exchange-inbound S3 →
lakehouse-service triggers ingestion → Bronze/Silver/Gold in the lakehouse bucket/Glue →
publication-service reads Gold → exchange-outbound S3 → presigned download; separately, Gold →
serving-projection-service → its RDS serving store → product-api-service → a real API response.
This is the same logical flow as local Docker Compose, over real AWS infrastructure.

---

## Part O — Security validation

### Step 35 — Tenant isolation

Create two test tenants and confirm Tenant A cannot read Tenant B's data through the API, the
exchange service, the database (RLS/app-layer filtering, per `docs/security/tenant-isolation.md`),
publication artifacts, or presigned S3 URLs. This is application-level behavior, unchanged by this
phase — Phase 12 does not re-implement or re-test it, only confirms the AWS deployment doesn't
introduce a new bypass (e.g. a presigned URL scoped too broadly).

### Step 36 — AWS security review

```bash
aws s3api get-public-access-block --bucket dpp-dev-exchange-inbound-<account-id>
aws rds describe-db-instances --query 'DBInstances[].PubliclyAccessible'
```

Confirm every result matches `docs/aws/security.md`'s guardrails.

---

## Part P — Observability

### Step 37

```bash
aws cloudwatch list-dashboards --dashboard-name-prefix dpp-dev
```

Open the dashboard, confirm metrics are populated, confirm correlation IDs still appear in
CloudWatch Logs (search for a known correlation ID from a test request).

---

## Part Q — Backup and recovery

### Step 38

```bash
aws backup list-backup-jobs --by-resource-arn <an RDS ARN>
```

Confirm the first scheduled backup job completes. Schedule an actual restore test separately
(`docs/aws/disaster-recovery.md`).

---

## Part R — Post-deployment

### Step 39

```bash
aws s3api get-bucket-versioning --bucket <state bucket>
aws s3api get-bucket-encryption --bucket <state bucket>
```

Never commit a `.tfstate` file to Git — confirm `git status` is clean of any.

### Step 40 — Record the deployment

Record, outside of Git (e.g. in your team's deployment log): AWS account, region, environment, Git
commit SHA, `terraform version` output, AWS provider version (`.terraform.lock.hcl`), the container
image digests from Part H/I, and the deployment timestamp.
