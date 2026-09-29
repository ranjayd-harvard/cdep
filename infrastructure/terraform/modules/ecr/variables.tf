variable "name_prefix" {
  type = string
}

variable "repositories" {
  description = "Logical repository keys, e.g. [\"customer-portal\", \"exchange-service\", ...]."
  type        = list(string)
}

variable "image_tag_mutability" {
  description = "IMMUTABLE (recommended — a pushed tag can never be overwritten, so a running task definition's image reference can't silently change) or MUTABLE."
  type        = string
  default     = "IMMUTABLE"
}

variable "untagged_image_expiry_days" {
  type    = number
  default = 14
}

variable "max_tagged_images_to_keep" {
  description = "Lifecycle policy keeps this many most-recent tagged images per repository, expiring the rest."
  type        = number
  default     = 20
}

variable "kms_key_arn" {
  description = "If set, encrypt repositories with this customer-managed key instead of the default AWS-managed AES256 key for ECR."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
