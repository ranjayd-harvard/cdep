# EventBridge is a transport layer for domain events these services already
# emit as Postgres row-state transitions (see docs/aws/eventing.md). It does
# not become a second workflow database: nothing here is authoritative, and
# scheduling-service's own cron/backoff/dead-letter logic is not replaced by
# an EventBridge schedule (see docs/aws/current-state-inventory.md).
#
# Rule -> target (SQS queue) wiring lives in the environment composition,
# not in this module, so this module has no dependency on modules/sqs.

resource "aws_cloudwatch_event_bus" "this" {
  name               = "${var.name_prefix}-domain-events"
  kms_key_identifier = var.kms_key_arn

  tags = merge(var.tags, { Name = "${var.name_prefix}-domain-events" })
}

resource "aws_cloudwatch_event_archive" "this" {
  name             = "${var.name_prefix}-domain-events-archive"
  event_source_arn = aws_cloudwatch_event_bus.this.arn
  retention_days   = 90
  description      = "Replay window for domain events — operational recovery only, not a system of record"
}

resource "aws_cloudwatch_event_rule" "domain_event" {
  for_each = toset(var.domain_events)

  name           = "${var.name_prefix}-${lower(each.value)}"
  event_bus_name = aws_cloudwatch_event_bus.this.name
  description    = "Routes ${each.value} domain events"

  event_pattern = jsonencode({
    "detail-type" = [each.value]
  })

  tags = merge(var.tags, { Name = "${var.name_prefix}-${lower(each.value)}" })
}

data "aws_iam_policy_document" "bus_policy" {
  statement {
    sid    = "AllowAccountPutEvents"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions   = ["events:PutEvents"]
    resources = [aws_cloudwatch_event_bus.this.arn]
    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_event_bus_policy" "this" {
  event_bus_name = aws_cloudwatch_event_bus.this.name
  policy         = data.aws_iam_policy_document.bus_policy.json
}
