output "application_id" {
  value = aws_emrserverless_application.lakehouse.id
}

output "application_arn" {
  value = aws_emrserverless_application.lakehouse.arn
}

output "job_role_arn" {
  value = aws_iam_role.job.arn
}
