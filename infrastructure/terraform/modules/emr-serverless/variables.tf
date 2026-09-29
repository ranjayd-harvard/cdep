variable "name_prefix" {
  type = string
}

variable "release_label" {
  description = "EMR release; must ship a Spark/Iceberg-compatible version if the existing PyIceberg/pyarrow jobs are ever ported to Spark. See docs/aws/lakehouse.md — no Spark rewrite happens in Phase 12."
  type        = string
  default     = "emr-7.1.0"
}

variable "subnet_ids" {
  description = "Private application subnet IDs the EMR Serverless application's VPC network config uses."
  type        = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "lakehouse_bucket_arn" {
  type = string
}

variable "glue_database_arns" {
  type = list(string)
}

variable "kms_key_arn" {
  type = string
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "max_cpu" {
  description = "Maximum vCPUs the application's pre-initialized + on-demand capacity may use concurrently."
  type        = string
  default     = "100 vCPU"
}

variable "max_memory" {
  type    = string
  default = "200 GB"
}

variable "max_disk" {
  type    = string
  default = "1000 GB"
}

variable "tags" {
  type    = map(string)
  default = {}
}
