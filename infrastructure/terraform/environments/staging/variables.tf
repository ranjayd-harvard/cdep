# Global variable model (Phase 12 §10). Concrete values live in
# terraform.tfvars (gitignored) — see terraform.tfvars.example for a
# starting point and docs/aws/new-account-deployment.md for how to fill it
# in against a real AWS account.

variable "project_name" {
  type    = string
  default = "dpp"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "aws_region" {
  type = string
}

variable "aws_account_id" {
  description = "Documentation/tagging only in this phase — no resource here is conditioned on it, and no credentials are derived from it. Terraform gets the real account from the provider's own credentials at apply time (`data.aws_caller_identity`)."
  type        = string
  default     = null
}

variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.10.0.0/24", "10.10.1.0/24"]
}

variable "private_app_subnet_cidrs" {
  type    = list(string)
  default = ["10.10.10.0/24", "10.10.11.0/24"]
}

variable "private_data_subnet_cidrs" {
  type    = list(string)
  default = ["10.10.20.0/24", "10.10.21.0/24"]
}

variable "domain_name" {
  description = "e.g. \"dev.dataproducts.example.com\". Required if enable_route53_records or enable_cloudfront is true."
  type        = string
  default     = null
}

variable "route53_hosted_zone_id" {
  description = "Existing hosted zone ID. Leave null and set create_route53_hosted_zone=true only if this account should own the zone itself."
  type        = string
  default     = null
}

variable "create_route53_hosted_zone" {
  type    = bool
  default = false
}

# --- Sizing -----------------------------------------------------------

variable "ecs_cpu" {
  description = "Uniform per-task vCPU units applied to every service in this environment. Grow specific services later by editing that service's module call, once real traffic data justifies it."
  type        = number
  default     = 256
}

variable "ecs_memory" {
  type    = number
  default = 512
}

variable "ecs_public_desired_count" {
  description = "Task count for internet-facing services (customer-portal, product-api-service)."
  type        = number
  default     = 1
}

variable "ecs_internal_desired_count" {
  type    = number
  default = 1
}

variable "ecs_max_capacity" {
  type    = number
  default = 3
}

variable "rds_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "rds_allocated_storage" {
  type    = number
  default = 50
}

variable "rds_multi_az" {
  type    = bool
  default = false
}

variable "rds_deletion_protection" {
  type    = bool
  default = true
}

variable "rds_skip_final_snapshot" {
  type    = bool
  default = false
}

variable "rds_backup_retention_days" {
  type    = number
  default = 14
}

variable "retention_days" {
  description = "Default CloudWatch log retention across every service in this environment."
  type        = number
  default     = 30
}

# --- Feature flags ------------------------------------------------------

variable "enable_waf" {
  type    = bool
  default = true
}

variable "enable_cloudfront" {
  type    = bool
  default = false
}

variable "enable_emr" {
  type    = bool
  default = true
}

variable "enable_nat_gateway" {
  type    = bool
  default = true
}

variable "single_nat_gateway" {
  type    = bool
  default = true
}

variable "acm_certificate_arn_override" {
  description = "Use a pre-existing ACM certificate (validated out-of-band) instead of having this stack manage Route 53 + ACM. Takes precedence over enable_route53_records. The ALB always terminates TLS, so one of this or enable_route53_records must be set before `apply` — see docs/aws/pre-deployment-checklist.md."
  type        = string
  default     = null
}

variable "enable_route53_records" {
  description = "If false, no DNS/ACM is created at all — the ALB DNS name (a Terraform output) is used directly, useful for a first dev deploy with no domain yet."
  type        = bool
  default     = false
}

variable "enable_vault_lock" {
  type    = bool
  default = false
}

variable "container_images" {
  description = <<-EOT
    Map of ECS service key -> full image reference. Phase 12 pushes no
    images, so every entry defaults to a placeholder that will fail to
    start until replaced — see docs/aws/new-account-deployment.md Part H/I.
    Override every key in terraform.tfvars once images exist in ECR.
  EOT
  type        = map(string)
  default     = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
