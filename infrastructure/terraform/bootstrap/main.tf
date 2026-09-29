# Bootstrap stack: creates the S3 bucket that every other Terraform root
# (environments/dev, environments/staging, environments/production) uses as
# its remote state backend.
#
# This stack intentionally uses LOCAL state on first run — a brand-new AWS
# account has no remote backend yet, so this is the one Terraform root in the
# whole repository that cannot depend on itself. See
# docs/aws/terraform-bootstrap.md for how to optionally migrate this stack's
# own state into the bucket it creates, once the bucket exists.
#
# No AWS resources are created by authoring this file. Nothing in this
# directory is applied during Phase 12 — see infrastructure/terraform/README.md.

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project   = var.project_name
        Component = "terraform-bootstrap"
        ManagedBy = "Terraform"
      },
      var.tags,
    )
  }
}

locals {
  name = "${var.project_name}-${var.environment}-tfstate"
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "state_key" {
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

  statement {
    sid    = "AllowS3ToUseTheKey"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_kms_key" "state" {
  count = var.enable_kms_encryption ? 1 : 0

  description             = "Encrypts Terraform remote state for ${var.project_name}/${var.environment}"
  deletion_window_in_days = var.kms_deletion_window_in_days
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.state_key.json

  tags = {
    Name = "${local.name}-key"
  }
}

resource "aws_kms_alias" "state" {
  count = var.enable_kms_encryption ? 1 : 0

  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.state[0].key_id
}

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  # Terraform state is precious and re-creating it is disruptive; require an
  # explicit `terraform destroy -target` acknowledgement rather than allowing
  # an ordinary apply to remove it by accident.
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name = local.name
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.enable_kms_encryption ? "aws:kms" : "AES256"
      kms_master_key_id = var.enable_kms_encryption ? aws_kms_key.state[0].arn : null
    }
    bucket_key_enabled = var.enable_kms_encryption
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Terraform state can contain sensitive values (Secrets Manager ARNs, RDS
# endpoints, etc — no plaintext database password ever lands here, since
# every environment uses RDS-managed master passwords, see modules/rds).
# Noncurrent versions are kept for a bounded window rather than forever so
# the bucket doesn't grow unbounded, without deleting the ability to roll
# back a recent bad apply.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-noncurrent-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 180
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json
}

data "aws_iam_policy_document" "state" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "DenyUnencryptedObjectUploads"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.state.arn}/*"]
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = var.enable_kms_encryption ? ["aws:kms"] : ["AES256"]
    }
  }

  dynamic "statement" {
    for_each = length(var.additional_state_reader_arns) > 0 ? [1] : []
    content {
      sid    = "AllowAdditionalStateReaders"
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = var.additional_state_reader_arns
      }
      actions = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
      ]
      resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    }
  }
}
