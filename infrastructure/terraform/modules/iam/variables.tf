variable "name_prefix" {
  type = string
}

variable "task_roles" {
  description = <<-EOT
    Map of role key (e.g. "exchange-service", "lakehouse-job") -> its trust
    principal and least-privilege statements. One ECS/EMR task role per
    workload — never one shared broad platform role. Statements are supplied
    by the caller (environment composition), which is the only place that
    knows the concrete resource ARNs (specific bucket ARNs, specific secret
    ARNs) a given service actually needs — see docs/aws/iam-permission-matrix.md.
  EOT
  type = map(object({
    trust_service = optional(string, "ecs-tasks.amazonaws.com")
    statements = list(object({
      sid       = optional(string)
      effect    = optional(string, "Allow")
      actions   = list(string)
      resources = list(string)
    }))
  }))
  default = {}
}

variable "ecs_execution_secret_arns" {
  description = "Secrets Manager ARNs the shared ECS task EXECUTION role may read to inject container secrets at task startup (distinct from the task role, which is the running application's own permissions)."
  type        = list(string)
  default     = []
}

variable "kms_decrypt_key_arns" {
  description = "KMS key ARNs the shared ECS task execution role may use to decrypt injected secrets."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
