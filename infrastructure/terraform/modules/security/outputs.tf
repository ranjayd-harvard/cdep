output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ecs_public_security_group_id" {
  value = aws_security_group.ecs_public.id
}

output "ecs_internal_security_group_id" {
  value = aws_security_group.ecs_internal.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}
