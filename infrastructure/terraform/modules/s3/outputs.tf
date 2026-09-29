output "bucket_names" {
  value = local.bucket_names
}

output "bucket_arns" {
  value = { for k, v in aws_s3_bucket.this : k => v.arn }
}

output "bucket_ids" {
  value = { for k, v in aws_s3_bucket.this : k => v.id }
}
