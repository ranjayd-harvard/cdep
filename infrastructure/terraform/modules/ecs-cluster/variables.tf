variable "name" {
  type = string
}

variable "container_insights_enabled" {
  type    = bool
  default = true
}

variable "log_retention_days" {
  description = "Retention for the cluster-level execute-command log group."
  type        = number
  default     = 30
}

variable "kms_key_arn" {
  description = "Encrypts the cluster's execute-command log group."
  type        = string
  default     = null
}

variable "vpc_id" {
  description = "Backs the ECS Service Connect / Cloud Map private DNS namespace, so internal services (exchange, catalog, subscription, scheduler, publication, observability, serving-projection, lakehouse) can reach each other by name instead of a hard-coded IP or a service-discovery mechanism this platform doesn't have locally today. See modules/ecs-service `service_connect` inputs and docs/aws/compute.md."
  type        = string
}

variable "service_connect_namespace" {
  description = "Private DNS namespace name for Service Connect, e.g. \"dpp-dev.internal\"."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
