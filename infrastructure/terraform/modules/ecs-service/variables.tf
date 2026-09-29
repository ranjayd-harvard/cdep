variable "name_prefix" {
  type = string
}

variable "service_name" {
  description = "Logical service key, e.g. \"customer-portal\", \"exchange-service\"."
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "container_image" {
  description = "Full image reference, e.g. \"<account>.dkr.ecr.<region>.amazonaws.com/dpp-dev-exchange-service:<tag>\". Phase 12 does not push any image — this is a variable precisely so a real tag can be supplied later without touching module code. See docs/aws/new-account-deployment.md Part H/I."
  type        = string
}

variable "container_port" {
  type = number
}

variable "cpu" {
  description = "Fargate task-level vCPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate task-level memory, MiB."
  type        = number
  default     = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "environment" {
  description = "Plain (non-secret) container environment variables."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Container environment variables sourced from Secrets Manager at task startup: map of env var name -> secret ARN (optionally \"arn:...:secret:name-abc123:json-key::\" to project a single JSON key)."
  type        = map(string)
  default     = {}
}

variable "task_role_arn" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "subnet_ids" {
  description = "Private application subnet IDs."
  type        = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "health_check_path" {
  description = "HTTP path for both the container health check and the ALB target group health check (this platform's services all expose one, e.g. /health/live or /api/health — see docs/aws/current-state-inventory.md)."
  type        = string
  default     = "/health/live"
}

variable "health_check_grace_period_seconds" {
  type    = number
  default = 60
}

# --- Optional ALB integration -------------------------------------------
# Leave alb_listener_arn null for internal-only services (exchange, catalog,
# subscription, scheduler, publication, observability) — they get no public
# route, matching the security-group boundary in modules/security.

variable "alb_listener_arn" {
  description = "HTTPS listener ARN to attach a routing rule to. Null for internal-only services."
  type        = string
  default     = null
}

variable "alb_listener_rule_priority" {
  type    = number
  default = null
}

variable "alb_path_patterns" {
  description = "Path patterns routed to this service, e.g. [\"/api/v1/*\"]. Required if alb_listener_arn is set."
  type        = list(string)
  default     = []
}

variable "alb_host_headers" {
  description = "Optional host-header condition, e.g. [\"portal.example.com\"]."
  type        = list(string)
  default     = []
}

variable "vpc_id" {
  description = "Required only when alb_listener_arn is set (target group needs it)."
  type        = string
  default     = null
}

# --- Service Connect (internal service-to-service DNS) -------------------

variable "service_connect_namespace_arn" {
  description = "From modules/ecs-cluster. Null disables Service Connect for this service."
  type        = string
  default     = null
}

variable "service_connect_dns_name" {
  description = "DNS name other services use to reach this one, e.g. \"catalog-service\" -> \"catalog-service.dpp-dev.internal\". Defaults to service_name."
  type        = string
  default     = null
}

# --- Autoscaling ----------------------------------------------------------

variable "enable_autoscaling" {
  type    = bool
  default = true
}

variable "min_capacity" {
  type    = number
  default = 1
}

variable "max_capacity" {
  type    = number
  default = 4
}

variable "cpu_target_utilization" {
  type    = number
  default = 60
}

variable "memory_target_utilization" {
  type    = number
  default = 70
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "kms_key_arn" {
  description = "Encrypts the service's CloudWatch log group."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
