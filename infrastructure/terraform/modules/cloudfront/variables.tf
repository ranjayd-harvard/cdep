variable "name_prefix" {
  type = string
}

variable "alb_dns_name" {
  description = "Origin domain — the ALB CloudFront sits in front of."
  type        = string
}

variable "domain_aliases" {
  description = "CNAMEs this distribution answers for, e.g. [\"portal.example.com\"]. Requires certificate_arn to be an us-east-1 ACM certificate."
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "us-east-1 ACM certificate ARN. CloudFront requires certificates in us-east-1 regardless of where the rest of the stack runs — see environments/*/providers.tf for the aliased provider this comes from."
  type        = string
  default     = null
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "web_acl_arn" {
  description = "AWS WAF WebACL ARN (must be a CLOUDFRONT-scope WebACL, from us-east-1) to associate. Null to run without WAF at the CDN layer."
  type        = string
  default     = null
}

variable "logging_bucket_domain_name" {
  description = "e.g. the audit bucket's bucket_domain_name, for standard CloudFront access logs. Null disables logging."
  type        = string
  default     = null
}

variable "min_ttl" {
  type    = number
  default = 0
}

variable "default_ttl" {
  type    = number
  default = 0 # this platform's responses are dynamic (auth'd app + API traffic) — CloudFront here is for TLS/edge termination and WAF attachment, not caching, unless the caller overrides this
}

variable "max_ttl" {
  type    = number
  default = 0
}

variable "tags" {
  type    = map(string)
  default = {}
}
