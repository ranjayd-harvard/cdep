# Security

This document covers AWS-infrastructure security. Application-level security (authorization
chain, tenant isolation, threat model) is already documented in `docs/security/` (Phase 11) — this
does not duplicate it, only maps it onto AWS where relevant.

## Trust boundaries → AWS security groups

`docs/security/trust-boundaries.md`'s three-tier model (Public / Application / Data) maps directly
onto `modules/security`'s chain: internet/CloudFront → ALB SG → ECS public-app SG → ECS internal SG
→ RDS SG. See `docs/aws/networking.md` for the diagram.

## Defense in depth: AWS controls are not a substitute for application authorization

AWS WAF (`modules/waf`), security groups, and IAM are edge/network/resource-access controls. None
of them replace the application's own authorization chain (`User → Organization → Tenant →
Entitlement → Data Product → Dataset`, `docs/security/architecture.md`). A request that passes WAF
and reaches an ECS task still goes through that same Keycloak-JWT → `SecurityContext` → RBAC →
Entitlement → Subscription → Contract chain, unchanged by this phase. Do not treat "WAF is enabled"
or "security groups are tight" as equivalent to "authorization is enforced."

## Encryption

| Data | At rest | In transit |
|---|---|---|
| S3 (all 4 buckets) | SSE-KMS, primary key (audit bucket: same or a dedicated audit key) | Bucket policy denies any request without `aws:SecureTransport` |
| RDS (all 7 instances) | `storage_encrypted = true`, primary KMS key | `rds.force_ssl = 1` parameter group setting — TLS is mandatory, not optional |
| Secrets Manager | KMS (primary key) | TLS (AWS API default) |
| CloudWatch Logs | KMS (primary key) on every log group | TLS (AWS API default) |
| ECS task definitions | N/A — no plaintext secrets in the task definition, only ARNs (`secrets` block) | — |

## KMS key boundary

See `docs/aws/architecture-decisions.md` #10. Two keys: `primary` (application data) and `audit`
(CloudTrail + audit bucket), not one key per resource. Both restrict `kms:Decrypt`/
`kms:GenerateDataKey*` to named AWS service principals (S3, RDS, Secrets Manager, CloudWatch Logs,
CloudTrail, Glue, EMR Serverless) scoped to this account — never `Principal: "*"`.

## Secrets

`modules/secrets` creates **empty** Secrets Manager containers only — no default, no
`terraform.tfvars` value, and no module ever sets a real secret value (Phase 12 §18/§19). Populate
real values post-`apply`:

```bash
aws secretsmanager put-secret-value --secret-id dpp-dev/portal/auth-secret --secret-string '...'
```

RDS credentials are the one exception that needs no manual population — `manage_master_user_password
= true` has AWS generate and store them automatically (see
`docs/aws/architecture-decisions.md` #4 for the `DATABASE_URL` composition consequence).

## No static AWS credentials anywhere

Every ECS task authenticates to AWS via its IAM task role (assumed automatically by the Fargate
agent) — no access key/secret key pair exists in any task definition, container image, or
`terraform.tfvars`. `docs/aws/iam-permission-matrix.md` lists exactly what each role can do.

## Guardrails against insecure defaults

- `modules/rds`: `publicly_accessible` is not a variable — hard-coded `false`.
- `modules/s3`: every bucket gets Block Public Access (all four settings), `BucketOwnerEnforced`
  ownership (no ACLs), and a policy denying unencrypted/non-TLS access.
- `modules/networking`: private data subnets have no internet route at all, regardless of security
  group state.
- `modules/security`: RDS's security group has no egress rule and only two scoped ingress rules.
- `modules/iam`: no task role is ever granted a wildcard resource on a data-plane action; the
  shared execution role only pulls images/ships logs/reads pre-named secret ARNs.

## Static security scanning — actually run against this package

This repository had no pre-existing IaC scanning convention. Two non-overlapping tools were run
against the whole `infrastructure/terraform/` tree while building it (not against any deployed
resource — none exists):

```bash
tflint --recursive .        # provider-schema / unused-variable linting
checkov -d . --framework terraform   # policy/security scanning
```

**tflint: clean.** Every unused-variable warning it found during development (`modules/alb`'s
unused `vpc_id`, `modules/security`'s unused `vpc_cidr`, `modules/eventbridge`'s unused
`kms_key_arn`, `modules/glue`'s unused `lakehouse_bucket_name`/`tags`) was fixed by either removing
the dead variable or actually wiring it up (event bus KMS encryption, Glue database
`location_uri`/tags) — see `git log`/the module source for the final shape. Current run: 0 issues.

**checkov: 724 passed / 104 failed**, down from an initial 650/124 after fixing what was
cost-effective to fix (VPC Flow Logs, default-SG lockdown, RDS log exports + IAM auth, ECS
exec-command + ephemeral-storage KMS encryption, WAF logging, CloudFront response headers policy,
the bootstrap KMS key's explicit policy, and every missing security-group-rule description). The
104 remaining failures were reviewed individually; none are silent gaps — every one is either a
false positive from checkov's static analysis, an AWS platform constraint, an intentional
environment-driven default, or a deferred feature with a stated reason:

| Category | Checks | Why not fixed now |
|---|---|---|
| **False positive — cross-module SG reference** | `CKV2_AWS_5` (SG "not attached") | Every flagged SG (`alb`, `ecs_public`, `ecs_internal`, `rds`, `vpc_endpoints`) genuinely is attached — to `aws_lb`/`aws_ecs_service`/`aws_db_instance`/`aws_vpc_endpoint` in a *different* module, referenced by ID through a module output. Checkov's static graph doesn't resolve that cross-module edge reliably. |
| **False positive — resolved at runtime** | `CKV_AWS_150`/`157`/`174`/`293` (ALB/RDS deletion-protection, RDS Multi-AZ, CloudFront TLS version) | These read `var.environment == "production"` or `var.certificate_arn != null` ternaries checkov can't evaluate without real tfvars. Production's `terraform.tfvars.example` sets the secure value; dev's cost-conscious defaults intentionally don't — see `docs/aws/database.md` sizing table. |
| **AWS platform constraint, not a choice** | `CKV_AWS_174` (again, the `cloudfront_default_certificate=true` branch specifically) | CloudFront forces TLSv1 when using its own shared default certificate — `minimum_protocol_version` cannot be set higher until a real ACM certificate is supplied, which is exactly what `enable_route53_records`/`acm_certificate_arn_override` are for. |
| **AWS-recommended pattern, commonly flagged anyway** | `CKV_AWS_109`/`111`/`356` on `modules/kms`'s key policy and the bootstrap key policy | Both include the standard `Principal: root, Action: kms:*, Resource: *` statement AWS's own KMS documentation recommends on every custom key policy (loses account recoverability otherwise). Every *other* statement on both keys is scoped to named service principals — see `docs/aws/architecture-decisions.md` #10. |
| **Intentional — needed for the HTTP→HTTPS redirect / initial reachability** | `CKV_AWS_260` (ingress 0.0.0.0/0:80), `CKV_AWS_378` (target groups use HTTP) | Port 80 on the ALB exists only to 301-redirect to 443 (`modules/alb`) — closing it would break that redirect for anyone who types the bare domain. Target groups use plain HTTP because TLS already terminates at the ALB; ALB→task traffic stays inside the private VPC. |
| **Deliberate trade-off, documented** | `CKV_AWS_382` (broad SG egress), `CKV_AWS_23` residual on the two managed-policy-attachment IAM roles | See "Guardrails" above for what *is* restricted (RDS has none, VPC endpoints are internal-only); ECS/ALB egress stays open because the ten services collectively need outbound HTTPS to varied AWS APIs and (for the portal) SMTP — enumerating every destination precisely was judged not worth the operational fragility it would add in this phase. |
| **Deferred — real but non-trivial additions** | `CKV_AWS_144` (S3 cross-region replication), `CKV2_AWS_38`/`39` (Route 53 DNSSEC / query logging), `CKV2_AWS_57` (Secrets Manager auto-rotation), `CKV_AWS_336` (read-only root FS), `CKV_AWS_305`/`310`/`374` (CloudFront default root object / origin failover / geo restriction), `CKV2_AWS_62` (S3 event notifications) | Each is a legitimate hardening step that needs a real design decision this phase shouldn't make silently: DNSSEC needs KSK/parent-registrar coordination; secret rotation needs a rotation Lambda (Phase 12 §3 explicitly discourages introducing Lambda without a real need); read-only root filesystem needs per-service verification that no code path writes to the container filesystem outside `/tmp`; S3 replication needs a second region's bucket+KMS key. Tracked here, not silently skipped. |
| **Not applicable to this architecture** | `CKV_AWS_21`/`18` residual mentions of the audit bucket | The audit bucket doesn't log to itself (there is no meaningful destination) and cannot expire/replace its own objects while Object Lock retention is active — both by design, see `docs/aws/storage.md`. |
| **Cost/retention trade-off, not a security gap** | `CKV_AWS_338` (1-year minimum log retention) | `retention_days` is 14/30/90 across dev/staging/production (`docs/aws/cost-model.md`) — a deliberate cost lever, adjustable per environment without a module change. |

Re-run both tools after any module change; a finding moving from this table into "unexplained" is
the signal something regressed.

## What Phase 12 explicitly does not attempt

No AWS resource was created or modified to build or scan this package — `tflint`/`checkov` above
ran entirely against local `.tf` source, needing no AWS credentials. See the final Phase 12 report
for the complete list of what was run locally versus deferred to a real deploy.
