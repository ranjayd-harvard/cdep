variable "name_prefix" {
  type = string
}

variable "kms_key_arn" {
  type = string
}

variable "recovery_window_in_days" {
  description = "Days before a deleted secret is permanently purged. 0 allows immediate deletion (convenient in dev, risky in production)."
  type        = number
  default     = 14
}

variable "secrets" {
  description = <<-EOT
    Map of logical secret key -> description. Terraform creates EMPTY secret
    containers only — no secret_string/value is ever set here (see
    docs/aws/new-account-deployment.md Part G for how to populate real
    values after `apply`). Expected keys, one per env/service that needs a
    non-database credential:
      portal/auth-secret                    - Auth.js AUTH_SECRET
      portal/google-oauth-client-secret      - AUTH_GOOGLE_SECRET
      portal/smtp-credentials                - SMTP_USER/SMTP_PASS as JSON
      identity/oidc-client-secret             - the platform's OIDC client secret
      product-api/cursor-signing-secret       - CURSOR_SIGNING_SECRET
      internal/service-api-keys               - the *_INTERNAL_API_KEY family, as JSON, one key per caller pair
  EOT
  type = map(object({
    description = string
  }))
}

variable "tags" {
  type    = map(string)
  default = {}
}
