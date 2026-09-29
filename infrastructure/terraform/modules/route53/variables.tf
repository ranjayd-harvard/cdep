variable "domain_name" {
  description = "e.g. \"dev.dataproducts.example.com\"."
  type        = string
}

variable "subject_alternative_names" {
  type    = list(string)
  default = []
}

variable "create_hosted_zone" {
  description = "If true, this stack creates (and owns the lifecycle of) the Route 53 public hosted zone for domain_name. If false (typical when the account/organization already owns the zone, e.g. a shared root domain), set hosted_zone_id instead and this module only manages records inside it."
  type        = bool
  default     = false
}

variable "hosted_zone_id" {
  description = "Existing hosted zone ID to use when create_hosted_zone is false."
  type        = string
  default     = null
}

variable "create_acm_certificate" {
  type    = bool
  default = true
}

variable "create_alb_alias_record" {
  description = "If true, creates an A/AAAA alias record at domain_name pointing at the ALB. Set false if CloudFront (not the ALB directly) should own the public DNS name — see modules/cloudfront."
  type        = bool
  default     = true
}

variable "alb_dns_name" {
  type    = string
  default = null
}

variable "alb_zone_id" {
  type    = string
  default = null
}

variable "cloudfront_domain_name" {
  description = "Set instead of alb_dns_name/alb_zone_id when CloudFront sits in front of the ALB and should own the public DNS alias."
  type        = string
  default     = null
}

variable "cloudfront_hosted_zone_id" {
  description = "Always Z2FDTNDATAQYW2 for CloudFront, but kept as a variable rather than hard-coded so a future non-AWS CDN swap (see docs/aws/gcp-portability.md) doesn't require editing this module."
  type        = string
  default     = "Z2FDTNDATAQYW2"
}

variable "tags" {
  type    = map(string)
  default = {}
}
