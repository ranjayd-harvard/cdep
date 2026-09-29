# Infrastructure-level observability only: CPU/memory/connection/storage
# alarms and a dashboard. This does NOT replace or duplicate
# data-platform-observability-service (Phase 9), which correlates
# application-level workflow state (exchange -> bronze -> silver -> gold ->
# publication -> delivery) across every service's own database. That
# correlation-ID-carrying application log format is unchanged by this
# module — see docs/aws/observability.md for how the two layers relate.

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  for_each = var.ecs_service_names

  alarm_name          = "${var.name_prefix}-${each.key}-ecs-cpu-high"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = var.ecs_cluster_name, ServiceName = each.value }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.ecs_cpu_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-ecs-cpu-high" })
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  for_each = var.ecs_service_names

  alarm_name          = "${var.name_prefix}-${each.key}-ecs-memory-high"
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = { ClusterName = var.ecs_cluster_name, ServiceName = each.value }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.ecs_memory_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-ecs-memory-high" })
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  for_each = var.rds_identifiers

  alarm_name          = "${var.name_prefix}-${each.key}-rds-cpu-high"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = each.value }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.rds_cpu_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-rds-cpu-high" })
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage_low" {
  for_each = var.rds_identifiers

  alarm_name          = "${var.name_prefix}-${each.key}-rds-free-storage-low"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = each.value }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.rds_free_storage_bytes_threshold
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-rds-free-storage-low" })
}

resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  for_each = var.rds_identifiers

  alarm_name          = "${var.name_prefix}-${each.key}-rds-connections-high"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = each.value }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.rds_connection_count_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-rds-connections-high" })
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx_high" {
  count = var.alb_arn_suffix != null ? 1 : 0

  alarm_name          = "${var.name_prefix}-alb-5xx-high"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 25
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-5xx-high" })
}

resource "aws_cloudwatch_metric_alarm" "target_unhealthy" {
  for_each = var.alb_arn_suffix != null ? var.target_group_arn_suffixes : {}

  alarm_name          = "${var.name_prefix}-${each.key}-unhealthy-hosts"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = each.value }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_actions
  ok_actions    = var.alarm_actions

  tags = merge(var.tags, { Name = "${var.name_prefix}-${each.key}-unhealthy-hosts" })
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.name_prefix}-platform"

  dashboard_body = jsonencode({
    widgets = concat(
      [for k, v in var.ecs_service_names : {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title  = "${k} — ECS CPU/Memory"
          view   = "timeSeries"
          region = data.aws_region.current.name
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", v],
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", v],
          ]
        }
      }],
      [for k, v in var.rds_identifiers : {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          title  = "${k} — RDS"
          view   = "timeSeries"
          region = data.aws_region.current.name
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", v],
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", v],
            ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", v],
          ]
        }
      }],
    )
  })
}

data "aws_region" "current" {}
