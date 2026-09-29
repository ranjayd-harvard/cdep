output "service_name" {
  value = aws_ecs_service.this.name
}

output "service_id" {
  value = aws_ecs_service.this.id
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "target_group_arn" {
  value = local.create_alb_integration ? aws_lb_target_group.this[0].arn : null
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}
