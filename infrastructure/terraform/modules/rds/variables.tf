variable "identifier" {
  description = "e.g. \"dpp-dev-exchange-service\" ({project}-{environment}-{service})."
  type        = string
}

variable "engine_version" {
  type    = string
  default = "16.4"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Initial storage, GiB."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling, GiB. Set equal to allocated_storage to disable autoscaling."
  type        = number
  default     = 100
}

variable "database_name" {
  type = string
}

variable "master_username" {
  type    = string
  default = "app_admin"
}

variable "subnet_ids" {
  description = "Private DATA subnet IDs only — never public subnets."
  type        = list(string)
}

variable "vpc_security_group_ids" {
  type = list(string)
}

variable "kms_key_arn" {
  type = string
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "backup_retention_period" {
  description = "Days of automated backups / PITR window. 0 disables backups — never set to 0 outside throwaway dev."
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Preferred UTC window for automated backups, e.g. \"03:00-04:00\"."
  type        = string
  default     = "03:00-04:00"
}

variable "maintenance_window" {
  description = "Preferred UTC window for maintenance, e.g. \"sun:04:30-sun:05:30\". Should not overlap backup_window."
  type        = string
  default     = "sun:04:30-sun:05:30"
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "skip_final_snapshot" {
  description = "If false (recommended, and required for production), a final snapshot is taken on destroy. Only set true for disposable dev/test instances."
  type        = bool
  default     = false
}

variable "performance_insights_enabled" {
  type    = bool
  default = true
}

variable "performance_insights_retention_days" {
  type    = number
  default = 7
}

variable "monitoring_interval_seconds" {
  description = "Enhanced Monitoring granularity in seconds. 0 disables it."
  type        = number
  default     = 60
}

variable "monitoring_role_arn" {
  description = "IAM role ARN for RDS Enhanced Monitoring to assume. Required if monitoring_interval_seconds > 0."
  type        = string
  default     = null
}

variable "apply_immediately" {
  description = "If false (recommended for production), changes apply during the next maintenance window instead of immediately."
  type        = bool
  default     = false
}

variable "parameter_group_family" {
  type    = string
  default = "postgres16"
}

variable "parameters" {
  description = "Additional DB parameter group parameters, e.g. [{name=\"log_min_duration_statement\", value=\"200\"}]."
  type = list(object({
    name         = string
    value        = string
    apply_method = optional(string, "immediate")
  }))
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
