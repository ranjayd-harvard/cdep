# IAM Permission Matrix

Every row below is one `modules/iam` task role (see `environments/*/main.tf`
`local.task_role_definitions`), plus the two roles that live in their own modules
(`lakehouse-job-role` in `modules/emr-serverless`, and the shared `ecs-task-execution-role` in
`modules/iam`). No role here has `iam:*`, `AdministratorAccess`, or a `Resource: "*"` statement on a
data-plane action. Every `resources` list is a concrete ARN (or ARN pattern scoped to this
project's own resources), assembled in the environment composition where the real ARNs are known.

| Role | Trust | Can do | Cannot do |
|---|---|---|---|
| `customer-portal-task-role` | ecs-tasks | Nothing beyond default network access — the portal talks to sibling services over HTTP (Service Connect), not AWS APIs directly | No S3, no RDS secret, no Glue |
| `exchange-service-task-role` | ecs-tasks | R/W `exchange-inbound` + `exchange-outbound` buckets; read its own RDS secret | No `lakehouse` bucket, no other service's secret, no Glue |
| `lakehouse-service-task-role` | ecs-tasks | R/W `lakehouse` bucket; read/write the three Glue databases; (if `enable_emr`) submit/inspect/cancel EMR Serverless job runs on this project's application only | No exchange buckets, no other service's RDS secret |
| `catalog-service-task-role` | ecs-tasks | Read its own RDS secret | No S3, no Glue, no other service's secret |
| `subscription-service-task-role` | ecs-tasks | Read its own RDS secret | Same as above |
| `scheduler-service-task-role` | ecs-tasks | Read its own RDS secret; `events:PutEvents` on this project's event bus only | No SQS send (it publishes events, doesn't own the queue), no S3/Glue |
| `publication-service-task-role` | ecs-tasks | Read its own RDS secret; read `lakehouse/gold/*`; write `exchange-outbound`; read the Glue Gold database | No Bronze/Silver S3 prefixes, no write access to `lakehouse` |
| `product-api-service-task-role` | ecs-tasks | Read `serving-projection-service`'s RDS secret (it reads that Postgres directly — see `docs/aws/current-state-inventory.md`) | No S3, no Glue, no other secret. It owns no data of its own |
| `observability-service-task-role` | ecs-tasks | Read its own RDS secret; read-only Glue (`GetDatabase`/`GetTable(s)`) for health reporting | No write access anywhere, no S3 |
| `serving-projection-service-task-role` | ecs-tasks | Read its own RDS secret; read `lakehouse/gold/*`; read the Glue Gold database | No write access to `lakehouse`, no Bronze/Silver |
| `lakehouse-job-role` (EMR Serverless execution role, `modules/emr-serverless`) | emr-serverless | R/W `lakehouse` bucket; R/W the three Glue databases/tables/partitions; write its own CloudWatch log group; decrypt with the primary KMS key | No exchange buckets, no Secrets Manager, no other service's resources |
| `ecs-task-execution-role` (shared, `modules/iam`) | ecs-tasks | Pull from any of this project's ECR repos (via the AWS-managed `AmazonECSTaskExecutionRolePolicy`); write to any of this project's log groups; read every RDS-managed secret + application secret in this project, to inject as container secrets at startup; decrypt with the primary KMS key | No task-role-equivalent application data access — this role never runs application code, only starts containers |
| `backup-role` (`modules/backup`) | backup.amazonaws.com | AWS-managed `AWSBackupServiceRolePolicyForBackup`/`...ForRestores`, scoped by the backup selection's resource list | — |

## Why the execution role is shared but task roles are not

The ECS **execution** role is infrastructure plumbing identical for every service (pull image, ship
logs, fetch secrets to inject) — sharing it grants no service access to another service's
*application* data, because injected secrets are determined by each service's own task definition,
not by the execution role's own policy scope beyond "can read these ARNs." The **task** role is
what the running application code can do with the AWS SDK at runtime, and that is never shared —
see Phase 12 §20/§21 ("Never create one shared broad platform role").

## Verifying this after deploy

```bash
aws iam list-role-policies --role-name dpp-<env>-exchange-service-task-role
aws iam get-role-policy --role-name dpp-<env>-exchange-service-task-role --policy-name dpp-<env>-exchange-service-task-policy
```

Confirm the `Resource` array never contains a bare `"*"` for a data-plane action, and that a
service's policy only names buckets/secrets it should reach — cross-reference against this table.
