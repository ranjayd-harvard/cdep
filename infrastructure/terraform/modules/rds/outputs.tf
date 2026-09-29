output "endpoint" {
  value = aws_db_instance.this.endpoint
}

output "address" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "identifier" {
  value = aws_db_instance.this.identifier
}

output "master_user_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master credentials (contains username/password/host/port/dbname JSON)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
  sensitive   = true
}

output "resource_id" {
  value = aws_db_instance.this.resource_id
}
