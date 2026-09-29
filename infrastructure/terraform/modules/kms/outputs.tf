output "primary_key_arn" {
  value = aws_kms_key.primary.arn
}

output "primary_key_id" {
  value = aws_kms_key.primary.key_id
}

output "primary_key_alias" {
  value = aws_kms_alias.primary.name
}

output "audit_key_arn" {
  value = var.create_audit_key ? aws_kms_key.audit[0].arn : null
}

output "audit_key_id" {
  value = var.create_audit_key ? aws_kms_key.audit[0].key_id : null
}
