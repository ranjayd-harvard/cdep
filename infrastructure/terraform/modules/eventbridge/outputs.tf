output "event_bus_name" {
  value = aws_cloudwatch_event_bus.this.name
}

output "event_bus_arn" {
  value = aws_cloudwatch_event_bus.this.arn
}

output "rule_arns" {
  value = { for k, v in aws_cloudwatch_event_rule.domain_event : k => v.arn }
}

output "rule_names" {
  value = { for k, v in aws_cloudwatch_event_rule.domain_event : k => v.name }
}
