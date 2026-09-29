# One task role per workload (never a shared platform role), each scoped to
# exactly what that service's IAM Permission Matrix entry says it needs. See
# docs/aws/iam-permission-matrix.md. No task role here is granted
# AdministratorAccess, iam:*, or a wildcard "*" resource on a data-plane
# action; every statement's `resources` list is supplied by the caller with
# concrete ARNs.

data "aws_iam_policy_document" "assume_role" {
  for_each = var.task_roles

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = [each.value.trust_service]
    }
  }
}

resource "aws_iam_role" "task" {
  for_each = var.task_roles

  name               = "${var.name_prefix}-${each.key}-task-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role[each.key].json

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-task-role" })
}

data "aws_iam_policy_document" "task" {
  for_each = { for k, v in var.task_roles : k => v if length(v.statements) > 0 }

  dynamic "statement" {
    for_each = each.value.statements
    content {
      sid       = statement.value.sid
      effect    = statement.value.effect
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "task" {
  for_each = data.aws_iam_policy_document.task

  name   = "${var.name_prefix}-${each.key}-task-policy"
  role   = aws_iam_role.task[each.key].id
  policy = each.value.json
}

# ---------------------------------------------------------------------------
# Shared ECS task EXECUTION role (pulls images, ships logs, injects secrets
# at container startup). This is infrastructure plumbing identical for every
# service, unlike the task role above — sharing it does not violate least
# privilege because it grants no access to any service's application data.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_execution_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${var.name_prefix}-ecs-task-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_execution_assume.json

  tags = merge(var.tags, { Name = "${var.name_prefix}-ecs-task-execution-role" })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  count = length(var.ecs_execution_secret_arns) > 0 ? 1 : 0

  statement {
    sid       = "ReadInjectedContainerSecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.ecs_execution_secret_arns
  }

  dynamic "statement" {
    for_each = length(var.kms_decrypt_key_arns) > 0 ? [1] : []
    content {
      sid       = "DecryptInjectedContainerSecrets"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = var.kms_decrypt_key_arns
    }
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  count = length(var.ecs_execution_secret_arns) > 0 ? 1 : 0

  name   = "${var.name_prefix}-ecs-task-execution-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets[0].json
}
