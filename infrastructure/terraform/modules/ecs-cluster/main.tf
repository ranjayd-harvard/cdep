resource "aws_cloudwatch_log_group" "exec_command" {
  name              = "/ecs/${var.name}/exec-command"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = merge(var.tags, { Name = "${var.name}-exec-command-logs" })
}

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights_enabled ? "enabled" : "disabled"
  }

  configuration {
    execute_command_configuration {
      kms_key_id = var.kms_key_arn
      logging    = "OVERRIDE"
      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.exec_command.name
      }
    }

    managed_storage_configuration {
      kms_key_id                           = var.kms_key_arn
      fargate_ephemeral_storage_kms_key_id = var.kms_key_arn
    }
  }

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = var.service_connect_namespace
  description = "ECS Service Connect namespace for ${var.name} — internal service-to-service DNS"
  vpc         = var.vpc_id

  tags = merge(var.tags, { Name = var.service_connect_namespace })
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name = aws_ecs_cluster.this.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}
