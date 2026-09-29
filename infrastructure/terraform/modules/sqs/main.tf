# Consumers must assume at-least-once delivery (standard SQS semantics) —
# this platform's existing idempotency-key handling (every TS service's
# idempotency_records table) already exists for this reason and needs no
# change.

resource "aws_sqs_queue" "dlq" {
  for_each = var.queues

  name                      = "${var.name_prefix}-${each.key}-dlq"
  message_retention_seconds = each.value.dlq_message_retention_seconds
  kms_master_key_id         = var.kms_key_arn
  sqs_managed_sse_enabled   = false

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-dlq" })
}

resource "aws_sqs_queue" "this" {
  for_each = var.queues

  name                       = "${var.name_prefix}-${each.key}"
  visibility_timeout_seconds = each.value.visibility_timeout_seconds
  message_retention_seconds  = each.value.message_retention_seconds
  kms_master_key_id          = var.kms_key_arn
  sqs_managed_sse_enabled    = false

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  })

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}" })
}

resource "aws_sqs_queue_redrive_allow_policy" "this" {
  for_each = var.queues

  queue_url = aws_sqs_queue.dlq[each.key].id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this[each.key].arn]
  })
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  for_each = var.queues

  alarm_name          = "${var.name_prefix}-${each.key}-dlq-not-empty"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq[each.key].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  alarm_description = "${each.key} dead-letter queue received at least one message — a consumer is failing repeatedly"

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-dlq-alarm" })
}
