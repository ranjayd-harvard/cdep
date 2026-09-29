# Key boundary decision (see docs/aws/security.md for the full writeup):
#
#   "primary" key  -> application data at rest: S3 (exchange inbound/
#                     outbound, lakehouse Bronze/Silver/Gold), RDS storage,
#                     Secrets Manager application/database secrets.
#   "audit" key    -> CloudTrail and the audit S3 bucket only, so audit data
#                     can be given a stricter, separately-administered key
#                     policy than day-to-day application data.
#
# We deliberately do NOT create one key per bucket/table — that multiplies
# IAM policy surface area for no isolation benefit, since every workload
# already goes through per-resource IAM anyway (see modules/iam).

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "key_policy" {
  statement {
    sid    = "EnableRootAccountAdministration"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(var.key_administrator_arns) > 0 ? [1] : []
    content {
      sid    = "AllowKeyAdministrators"
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = var.key_administrator_arns
      }
      actions = [
        "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*",
        "kms:Put*", "kms:Update*", "kms:Revoke*", "kms:Disable*",
        "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
      ]
      resources = ["*"]
    }
  }

  # Named AWS service principals only (never Principal "*") so the services
  # that legitimately need to encrypt/decrypt with this key — S3, RDS,
  # Secrets Manager, CloudWatch Logs, CloudTrail, Glue, EMR Serverless — can,
  # without granting every principal in the account implicit access.
  statement {
    sid    = "AllowServiceIntegrations"
    effect = "Allow"
    principals {
      type = "Service"
      identifiers = [
        "s3.amazonaws.com",
        "rds.amazonaws.com",
        "secretsmanager.amazonaws.com",
        "logs.amazonaws.com",
        "cloudtrail.amazonaws.com",
        "glue.amazonaws.com",
        "emr-serverless.amazonaws.com",
      ]
    }
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_kms_key" "primary" {
  description             = "${var.name_prefix} primary data-at-rest key: S3 exchange/lakehouse buckets, RDS, Secrets Manager"
  deletion_window_in_days = var.deletion_window_in_days
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.key_policy.json

  tags = merge(var.tags, { Name = "${var.name_prefix}-primary-key" })
}

resource "aws_kms_alias" "primary" {
  name          = "alias/${var.name_prefix}-primary"
  target_key_id = aws_kms_key.primary.key_id
}

resource "aws_kms_key" "audit" {
  count = var.create_audit_key ? 1 : 0

  description             = "${var.name_prefix} audit key: CloudTrail and the audit S3 bucket"
  deletion_window_in_days = var.deletion_window_in_days
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.key_policy.json

  tags = merge(var.tags, { Name = "${var.name_prefix}-audit-key" })
}

resource "aws_kms_alias" "audit" {
  count = var.create_audit_key ? 1 : 0

  name          = "alias/${var.name_prefix}-audit"
  target_key_id = aws_kms_key.audit[0].key_id
}
