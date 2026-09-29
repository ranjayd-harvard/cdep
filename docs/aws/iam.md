# IAM

See `docs/aws/iam-permission-matrix.md` for the full role-by-role table. This document covers the
structural rules `modules/iam` and `modules/emr-serverless` follow.

## One role per workload

Ten ECS task roles (one per `modules/ecs-service` instantiation) plus one EMR Serverless job role,
plus one shared ECS task **execution** role (distinct purpose — see below), plus one AWS Backup
service role. No role is shared across application workloads, and no role has a wildcard resource
on a data-plane action — every `resources` list in `environments/*/main.tf`
`local.task_role_definitions` names concrete ARNs assembled from other modules' outputs.

## Task role vs. execution role

These are different AWS concepts, both required by every Fargate task definition:

- **Task role**: what the *running application* can do via the AWS SDK (e.g. `publication-service`
  reading `lakehouse/gold/*`). Unique per service.
- **Execution role**: what *ECS itself* does on the task's behalf before your code ever runs —
  pull the container image, fetch injected secrets, create the log stream. Shared across every
  service in an environment (`modules/iam`'s `aws_iam_role.ecs_execution`), because it grants no
  application-data access at all, only pull/log/secret-fetch plumbing scoped to this project's own
  ECR repos, log groups, and secret ARNs.

## No task ever gets a static AWS access key

Every task role is assumed automatically by the Fargate agent via the task's IAM role ARN in its
task definition — there is no access-key/secret-key pair anywhere in this repository, any
`terraform.tfvars`, or any container image.

## Extending this later

Adding a new service means adding one entry to `local.task_role_definitions` in the relevant
`environments/<env>/main.tf` with that service's own least-privilege statements — never adding it
to an existing role's policy, and never reusing another service's role.
