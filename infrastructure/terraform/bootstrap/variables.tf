variable "project_name" {
  description = "Short project identifier used in resource naming, e.g. \"dpp\" (Data Product Platform)."
  type        = string
  default     = "dpp"
}

variable "environment" {
  description = "Logical name for the account/environment this bootstrap stack serves, e.g. \"dev\", \"staging\", \"production\", or \"shared\" if one state bucket serves every environment in this account."
  type        = string
}

variable "aws_region" {
  description = "AWS region the Terraform state bucket is created in. State can still be used by stacks deployed to other regions."
  type        = string
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket name for Terraform remote state. Must be set explicitly — there is no safe default, since S3 bucket names are global. Example: \"acme-dpp-tfstate-123456789012\"."
  type        = string

  validation {
    condition     = length(var.state_bucket_name) > 0 && var.state_bucket_name == lower(var.state_bucket_name)
    error_message = "state_bucket_name must be a non-empty, lowercase S3-compliant bucket name."
  }
}

variable "additional_state_reader_arns" {
  description = "Optional list of IAM principal ARNs (roles/users) granted read/write access to the state bucket in addition to the account's default administrative access, e.g. a CI/CD deployment role."
  type        = list(string)
  default     = []
}

variable "enable_kms_encryption" {
  description = "If true, encrypt the state bucket with a dedicated customer-managed KMS key instead of SSE-S3 (AES256). Recommended for staging/production."
  type        = bool
  default     = true
}

variable "kms_deletion_window_in_days" {
  description = "Waiting period before the bootstrap KMS key is deleted if ever destroyed. Ignored when enable_kms_encryption is false."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Additional tags merged onto every resource this stack creates."
  type        = map(string)
  default     = {}
}
