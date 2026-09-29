# Creates empty Secrets Manager containers only. No terraform.tfvars, module
# default, or resource in this repository ever sets a real secret value —
# see docs/aws/new-account-deployment.md Part G. Populate values with:
#
#   aws secretsmanager put-secret-value \
#     --secret-id <name> --secret-string '...'
#
# after `terraform apply`, from a securely-held value, never from Git.

resource "aws_secretsmanager_secret" "this" {
  for_each = var.secrets

  name                    = "${var.name_prefix}/${each.key}"
  description             = each.value.description
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days

  tags = merge(var.tags, { Name = "${var.name_prefix}/${each.key}" })
}
