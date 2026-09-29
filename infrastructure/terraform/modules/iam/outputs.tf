output "task_role_arns" {
  value = { for k, v in aws_iam_role.task : k => v.arn }
}

output "task_role_names" {
  value = { for k, v in aws_iam_role.task : k => v.name }
}

output "ecs_execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}

output "ecs_execution_role_name" {
  value = aws_iam_role.ecs_execution.name
}
