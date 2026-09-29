variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "alb_ingress_cidrs" {
  description = "CIDRs allowed to reach the ALB directly on 80/443. Restrict this (e.g. to a CloudFront managed prefix list, once one is provisioned) if the ALB should only be reachable through CloudFront/WAF."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "container_port_range" {
  description = "Port range ECS Fargate tasks listen on (the ALB target group / container port range across all public-facing services)."
  type = object({
    from = number
    to   = number
  })
  default = {
    from = 1024
    to   = 65535
  }
}

variable "database_port" {
  type    = number
  default = 5432
}

variable "tags" {
  type    = map(string)
  default = {}
}
