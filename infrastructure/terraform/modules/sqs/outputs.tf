output "queue_urls" {
  value = { for k, v in aws_sqs_queue.this : k => v.url }
}

output "queue_arns" {
  value = { for k, v in aws_sqs_queue.this : k => v.arn }
}

output "dlq_arns" {
  value = { for k, v in aws_sqs_queue.dlq : k => v.arn }
}
