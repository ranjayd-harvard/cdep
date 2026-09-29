variable "name_prefix" {
  description = "Naming prefix, e.g. \"dpp-dev\" ({project}-{environment})."
  type        = string
}

variable "vpc_cidr" {
  type = string
}

variable "availability_zones" {
  description = "AZs to spread subnets across. Length must match the subnet CIDR lists."
  type        = list(string)
}

variable "public_subnet_cidrs" {
  type = list(string)
}

variable "private_app_subnet_cidrs" {
  type = list(string)
}

variable "private_data_subnet_cidrs" {
  type = list(string)
}

variable "enable_nat_gateway" {
  description = "If true, create NAT gateway(s) so private subnets reach the internet (needed for ECR/package pulls unless VPC endpoints cover everything). If false, private subnets have no outbound internet path."
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "If true, create one NAT gateway (cheaper, single point of failure across AZs — fine for dev). If false, one NAT gateway per AZ (recommended for production)."
  type        = bool
  default     = true
}

variable "enable_vpc_endpoints" {
  description = "If true, create VPC interface/gateway endpoints for S3, ECR, Secrets Manager, and CloudWatch Logs so ECS tasks in private subnets don't need NAT for those calls."
  type        = bool
  default     = true
}

variable "enable_flow_logs" {
  description = "If true, capture VPC Flow Logs (ACCEPT+REJECT) to a dedicated CloudWatch log group — the network-layer audit trail complementing CloudTrail's control-plane audit trail."
  type        = bool
  default     = true
}

variable "flow_log_retention_days" {
  type    = number
  default = 30
}

variable "kms_key_arn" {
  description = "Encrypts the VPC Flow Logs log group. Required if enable_flow_logs is true."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
