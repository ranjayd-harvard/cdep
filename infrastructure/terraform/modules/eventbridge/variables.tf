variable "name_prefix" {
  type = string
}

variable "domain_events" {
  description = <<-EOT
    Logical domain event names this bus carries. Sourced from the platform's
    existing state-transition vocabulary — NOT a new workflow model. Default
    list matches docs/aws/current-state-inventory.md / eventing.md: the
    events data-exchange-service's pipeline_jobs table, scheduling-service,
    and data-publication-service already represent as Postgres row states.
    EventBridge only transports notice of these transitions; the owning
    service's own database row remains authoritative (see docs/aws/eventing.md).
  EOT
  type        = list(string)
  default = [
    "ExchangeUploaded",
    "BronzeReady",
    "SilverReady",
    "GoldReady",
    "PublicationRequested",
    "PublicationReady",
    "DeliveryReady",
  ]
}

variable "kms_key_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
