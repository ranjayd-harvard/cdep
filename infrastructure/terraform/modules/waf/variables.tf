variable "name_prefix" {
  type = string
}

variable "scope" {
  description = "\"CLOUDFRONT\" (must be created in us-east-1 — see environments/*/providers.tf) or \"REGIONAL\" (for direct ALB association, in the stack's own region)."
  type        = string

  validation {
    condition     = contains(["CLOUDFRONT", "REGIONAL"], var.scope)
    error_message = "scope must be CLOUDFRONT or REGIONAL."
  }
}

variable "rate_limit_requests_per_5min" {
  description = "Per-IP request budget over a rolling 5-minute window before the rate-based rule blocks that IP. AWS WAF is edge/network-layer rate limiting only — it is not a substitute for the platform's own entitlement/authorization checks (see docs/aws/security.md)."
  type        = number
  default     = 3000
}

variable "managed_rule_groups" {
  description = "AWS managed rule group names to enable, in COUNT mode by default (see enable_blocking)."
  type        = list(string)
  default = [
    "AWSManagedRulesCommonRuleSet",
    "AWSManagedRulesKnownBadInputsRuleSet",
    "AWSManagedRulesAmazonIpReputationList",
  ]
}

variable "enable_blocking" {
  description = "If false (recommended first deploy), every rule runs in COUNT mode so you can observe what WOULD be blocked before enforcing it. Flip to true once matches have been reviewed in CloudWatch."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "kms_key_arn" {
  description = "Encrypts the WAF logging CloudWatch log group."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
