resource "aws_backup_vault" "this" {
  name        = "${var.name_prefix}-backup-vault"
  kms_key_arn = var.kms_key_arn

  tags = merge(var.tags, { Name = "${var.name_prefix}-backup-vault" })
}

# Prevents anyone (including via a compromised admin credential, absent an
# explicit vault lock removal) from deleting recovery points out from under
# an active incident. See docs/aws/backup-recovery.md for the tradeoffs of
# enabling `changeable_for_days` vs. permanent compliance-mode lock.
resource "aws_backup_vault_lock_configuration" "this" {
  count = var.enable_vault_lock ? 1 : 0

  backup_vault_name   = aws_backup_vault.this.name
  min_retention_days  = 7
  max_retention_days  = 365
  changeable_for_days = var.vault_lock_changeable_for_days
}

resource "aws_backup_plan" "this" {
  name = "${var.name_prefix}-backup-plan"

  rule {
    rule_name         = "${var.name_prefix}-daily"
    target_vault_name = aws_backup_vault.this.name
    schedule          = var.schedule_cron

    lifecycle {
      cold_storage_after = var.cold_storage_after_days
      delete_after       = var.delete_after_days
    }
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-backup-plan" })
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.name_prefix}-backup-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json

  tags = merge(var.tags, { Name = "${var.name_prefix}-backup-role" })
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_selection" "this" {
  name         = "${var.name_prefix}-backup-selection"
  plan_id      = aws_backup_plan.this.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = var.resource_arns
}
