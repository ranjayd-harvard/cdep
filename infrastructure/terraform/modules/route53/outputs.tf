output "zone_id" {
  value = local.zone_id
}

output "certificate_arn" {
  value = var.create_acm_certificate ? aws_acm_certificate_validation.this[0].certificate_arn : null
}

output "name_servers" {
  description = "Only populated when create_hosted_zone is true — delegate the parent domain to these if this zone was newly created."
  value       = var.create_hosted_zone ? aws_route53_zone.this[0].name_servers : null
}
