variable "name_prefix" {
  type = string
}

variable "resource_arns" {
  description = "ARNs of resources to back up (e.g. RDS instance ARNs). AWS Backup for RDS is additional/complementary to RDS's own automated backups (modules/rds already configures backup_retention_period/PITR) — this gives a second, independently-schedulable recovery point with its own vault/lifecycle."
  type        = list(string)
}

variable "kms_key_arn" {
  type = string
}

variable "schedule_cron" {
  description = "AWS Backup cron expression, e.g. daily at 05:00 UTC."
  type        = string
  default     = "cron(0 5 * * ? *)"
}

variable "cold_storage_after_days" {
  description = "Null to never transition to cold storage."
  type        = number
  default     = null
}

variable "delete_after_days" {
  type    = number
  default = 35
}

variable "enable_vault_lock" {
  description = <<-EOT
    If true, applies a vault lock. Defaults to false because, WITHOUT
    vault_lock_changeable_for_days set, an AWS Backup vault lock becomes a
    permanent COMPLIANCE-mode lock the instant it's applied — not even the
    root user can remove or loosen it before recovery points' retention
    expires. Only enable this (and review vault_lock_changeable_for_days)
    for production, deliberately, per docs/aws/backup-recovery.md — never as
    a default that fires on a dev/staging `terraform apply`.
  EOT
  type        = bool
  default     = false
}

variable "vault_lock_changeable_for_days" {
  description = "Grace period (GOVERNANCE mode) during which the lock can still be removed/loosened. Null makes the lock permanent (COMPLIANCE mode) immediately — only ever set this to null deliberately for a production vault that has already been operated in governance mode and reviewed."
  type        = number
  default     = 3
}

variable "tags" {
  type    = map(string)
  default = {}
}
