variable "name_prefix" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_names" {
  description = "Logical key -> ECS service name, for per-service CPU/memory alarms."
  type        = map(string)
}

variable "rds_identifiers" {
  description = "Logical key -> RDS instance identifier, for per-database alarms."
  type        = map(string)
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix (the part CloudWatch dimensions use), e.g. from `aws_lb.this.arn_suffix`. Null skips ALB-level alarms (internal-only environments)."
  type        = string
  default     = null
}

variable "target_group_arn_suffixes" {
  description = "Logical key -> target group ARN suffix, for unhealthy-host alarms on public-facing services."
  type        = map(string)
  default     = {}
}

variable "alarm_actions" {
  description = "SNS topic ARNs or other CloudWatch alarm action ARNs. Empty = alarms created but silent until wired to a notification target."
  type        = list(string)
  default     = []
}

variable "ecs_cpu_threshold" {
  type    = number
  default = 85
}

variable "ecs_memory_threshold" {
  type    = number
  default = 85
}

variable "rds_cpu_threshold" {
  type    = number
  default = 80
}

variable "rds_free_storage_bytes_threshold" {
  type    = number
  default = 2000000000 # 2 GB
}

variable "rds_connection_count_threshold" {
  type    = number
  default = 80
}

variable "tags" {
  type    = map(string)
  default = {}
}
