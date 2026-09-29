output "vpc_id" {
  value = module.networking.vpc_id
}

output "private_app_subnet_ids" {
  value = module.networking.private_app_subnet_ids
}

output "private_data_subnet_ids" {
  value = module.networking.private_data_subnet_ids
}

output "alb_dns_name" {
  value = module.alb.alb_dns_name
}

output "cloudfront_distribution_domain" {
  value = var.enable_cloudfront ? module.cloudfront[0].domain_name : null
}

output "rds_endpoints" {
  value = { for k, v in module.rds : k => v.endpoint }
}

output "rds_secret_arns" {
  value     = { for k, v in module.rds : k => v.master_user_secret_arn }
  sensitive = true
}

output "ecr_repository_urls" {
  value = module.ecr.repository_urls
}

output "inbound_bucket_name" {
  value = module.s3.bucket_names["exchange-inbound"]
}

output "outbound_bucket_name" {
  value = module.s3.bucket_names["exchange-outbound"]
}

output "lakehouse_bucket_name" {
  value = module.s3.bucket_names["lakehouse"]
}

output "audit_bucket_name" {
  value = module.s3.bucket_names["audit"]
}

output "ecs_cluster_name" {
  value = module.ecs_cluster.cluster_name
}

output "service_connect_namespace" {
  value = module.ecs_cluster.service_connect_namespace_name
}

output "glue_database_names" {
  value = {
    bronze = module.glue.bronze_database_name
    silver = module.glue.silver_database_name
    gold   = module.glue.gold_database_name
  }
}

output "emr_serverless_application_id" {
  value = var.enable_emr ? module.emr_serverless[0].application_id : null
}

output "event_bus_name" {
  value = module.eventbridge.event_bus_name
}

output "queue_urls" {
  value = module.sqs.queue_urls
}

output "task_role_arns" {
  value = module.iam.task_role_arns
}
