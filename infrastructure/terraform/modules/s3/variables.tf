variable "name_prefix" {
  description = "e.g. \"dpp-dev\" ({project}-{environment}). Bucket names are \"{name_prefix}-{bucket key}-{bucket_suffix}\"."
  type        = string
}

variable "bucket_suffix" {
  description = "Extra uniqueness token appended to every bucket name, since S3 bucket names are global. Convention: the AWS account ID. Never generated randomly by Terraform, so bucket names are predictable across plans."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key used for SSE-KMS on every bucket except the audit bucket (which uses audit_kms_key_arn if set)."
  type        = string
}

variable "audit_kms_key_arn" {
  description = "KMS key for the audit bucket. Defaults to kms_key_arn if not set."
  type        = string
  default     = null
}

variable "buckets" {
  description = <<-EOT
    Map of logical bucket key -> configuration. Logical keys expected by the
    rest of this platform: "exchange-inbound", "exchange-outbound",
    "lakehouse", "audit". Each entry:
      versioning_enabled            bool
      is_audit_bucket               bool  - true only for the audit/log-destination bucket itself
      enable_access_logging         bool  - ship S3 access logs to the audit bucket
      object_lock_enabled           bool  - WORM protection (legal hold / governance retention)
      noncurrent_version_expiration_days number, or null to never expire noncurrent versions
      transition_ia_days            number, or null to skip Standard-IA transition
      transition_glacier_days       number, or null to skip Glacier transition
      expiration_days               number, or null to never expire current objects
                                     (leave null for lakehouse — Iceberg snapshot/metadata
                                     lifetime is managed by Iceberg maintenance jobs, not
                                     blanket S3 expiration, see docs/aws/lakehouse.md)
  EOT
  type = map(object({
    versioning_enabled                 = bool
    is_audit_bucket                    = optional(bool, false)
    enable_access_logging              = optional(bool, true)
    object_lock_enabled                = optional(bool, false)
    noncurrent_version_expiration_days = optional(number, 90)
    transition_ia_days                 = optional(number, null)
    transition_glacier_days            = optional(number, null)
    expiration_days                    = optional(number, null)
  }))
}

variable "tags" {
  type    = map(string)
  default = {}
}
