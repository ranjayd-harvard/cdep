locals {
  full_name = "${var.name_prefix}-${var.service_name}"

  container_environment = [for k, v in var.environment : { name = k, value = v }]
  container_secrets     = [for k, v in var.secrets : { name = k, valueFrom = v }]

  create_alb_integration = var.alb_listener_arn != null
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.full_name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = merge(var.tags, { Name = "/ecs/${local.full_name}" })
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.full_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = var.service_name
      image     = var.container_image
      essential = true
      portMappings = [
        {
          name          = "app"
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]
      environment = local.container_environment
      secrets     = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }
      # No container-level HEALTHCHECK here on purpose: the services in this
      # platform run on different base images (Alpine/Node vs. Python slim)
      # with no single reliable HTTP-check binary in common. Public services
      # are health-checked by the ALB target group below; internal services
      # are health-checked by data-platform-observability-service's existing
      # poll loop (see docs/aws/observability.md).
    }
  ])

  tags = merge(var.tags, { Name = local.full_name })
}

data "aws_region" "current" {}

resource "aws_lb_target_group" "this" {
  count = local.create_alb_integration ? 1 : 0

  name        = substr("${local.full_name}-tg", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = var.health_check_path
    protocol            = "HTTP"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200-299"
  }

  deregistration_delay = 30

  tags = merge(var.tags, { Name = "${local.full_name}-tg" })
}

resource "aws_lb_listener_rule" "this" {
  count = local.create_alb_integration ? 1 : 0

  listener_arn = var.alb_listener_arn
  priority     = var.alb_listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }

  condition {
    path_pattern {
      values = var.alb_path_patterns
    }
  }

  dynamic "condition" {
    for_each = length(var.alb_host_headers) > 0 ? [1] : []
    content {
      host_header {
        values = var.alb_host_headers
      }
    }
  }

  tags = merge(var.tags, { Name = "${local.full_name}-rule" })
}

resource "aws_ecs_service" "this" {
  name            = local.full_name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = local.create_alb_integration ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.this[0].arn
      container_name   = var.service_name
      container_port   = var.container_port
    }
  }

  health_check_grace_period_seconds = local.create_alb_integration ? var.health_check_grace_period_seconds : null

  dynamic "service_connect_configuration" {
    for_each = var.service_connect_namespace_arn != null ? [1] : []
    content {
      enabled   = true
      namespace = var.service_connect_namespace_arn

      service {
        port_name      = "app"
        discovery_name = coalesce(var.service_connect_dns_name, var.service_name)

        client_alias {
          port     = var.container_port
          dns_name = coalesce(var.service_connect_dns_name, var.service_name)
        }
      }

      log_configuration {
        log_driver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "service-connect"
        }
      }
    }
  }

  enable_execute_command = true

  lifecycle {
    ignore_changes = [task_definition] # updated via CI/CD (Part I), not by re-running `terraform apply` on every deploy
  }

  tags = merge(var.tags, { Name = local.full_name })
}

# ---------------------------------------------------------------------------
# Autoscaling
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "this" {
  count = var.enable_autoscaling ? 1 : 0

  service_namespace  = "ecs"
  resource_id        = "service/${split("/", var.cluster_arn)[1]}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
}

resource "aws_appautoscaling_policy" "cpu" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.full_name}-cpu-target"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace
  resource_id        = aws_appautoscaling_target.this[0].resource_id
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.cpu_target_utilization
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "memory" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.full_name}-memory-target"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace
  resource_id        = aws_appautoscaling_target.this[0].resource_id
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = var.memory_target_utilization
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}
