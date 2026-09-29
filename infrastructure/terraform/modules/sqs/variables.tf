variable "name_prefix" {
  type = string
}

variable "queues" {
  description = "Map of logical queue key -> config. Each gets its own DLQ automatically."
  type = map(object({
    visibility_timeout_seconds    = optional(number, 60)
    message_retention_seconds     = optional(number, 345600) # 4 days
    max_receive_count             = optional(number, 5)
    dlq_message_retention_seconds = optional(number, 1209600) # 14 days
  }))
}

variable "kms_key_arn" {
  type = string
}

variable "alarm_actions" {
  description = "SNS topic ARNs (or other CloudWatch alarm action ARNs) notified when a DLQ receives messages. Empty = alarms created but silent (no action wired) until the caller adds one."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
