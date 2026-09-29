variable "name_prefix" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Required — this module does not create an HTTP-only listener beyond the redirect."
  type        = string
}

variable "additional_certificate_arns" {
  description = "Extra ACM certificates (SNI) attached to the HTTPS listener beyond the default one, e.g. for multiple domains."
  type        = list(string)
  default     = []
}

variable "ssl_policy" {
  type    = string
  default = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "enable_deletion_protection" {
  type    = bool
  default = true
}

variable "access_logs_bucket" {
  description = "S3 bucket (e.g. the audit bucket) to ship ALB access logs to. Null disables ALB access logging."
  type        = string
  default     = null
}

variable "access_logs_prefix" {
  type    = string
  default = "alb-access-logs"
}

variable "idle_timeout_seconds" {
  type    = number
  default = 60
}

variable "tags" {
  type    = map(string)
  default = {}
}
