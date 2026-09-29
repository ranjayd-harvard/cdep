output "state_bucket_name" {
  description = "S3 bucket name to use as `bucket` in every environment's backend.<env>.hcl file."
  value       = aws_s3_bucket.state.id
}

output "state_bucket_arn" {
  value = aws_s3_bucket.state.arn
}

output "state_kms_key_arn" {
  description = "ARN of the KMS key protecting state, if enable_kms_encryption is true."
  value       = var.enable_kms_encryption ? aws_kms_key.state[0].arn : null
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}
