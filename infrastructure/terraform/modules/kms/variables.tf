variable "name_prefix" {
  type = string
}

variable "deletion_window_in_days" {
  type    = number
  default = 30
}

variable "create_audit_key" {
  description = "Creates a second, separate KMS key dedicated to audit/CloudTrail/security-log data, so the IAM policy that can decrypt audit data can differ from the one that can decrypt application data (separation of duties)."
  type        = bool
  default     = true
}

variable "key_administrator_arns" {
  description = "IAM principal ARNs allowed full KMS administrative actions (key policy, rotation, scheduling deletion) on these keys, in addition to the account root. Typically a platform-admin role, never an application task role."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
