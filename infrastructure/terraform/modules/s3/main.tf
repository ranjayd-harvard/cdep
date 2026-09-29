locals {
  bucket_names = { for k, v in var.buckets : k => "${var.name_prefix}-${k}-${var.bucket_suffix}" }
}

resource "aws_s3_bucket" "this" {
  for_each = var.buckets

  bucket = local.bucket_names[each.key]

  # Buckets hold customer data (exchange) or Iceberg table data (lakehouse)
  # or the audit trail itself — accidental `terraform destroy` must not be
  # a one-command data-loss event.
  lifecycle {
    prevent_destroy = true
  }

  object_lock_enabled = each.value.object_lock_enabled

  tags = merge(var.tags, { Name = local.bucket_names[each.key] })
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = var.buckets

  bucket = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = each.value.versioning_enabled ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = var.buckets

  bucket = aws_s3_bucket.this[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = each.value.is_audit_bucket ? coalesce(var.audit_kms_key_arn, var.kms_key_arn) : var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = var.buckets

  bucket = aws_s3_bucket.this[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = var.buckets

  bucket = aws_s3_bucket.this[each.key].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Access logging: every non-audit bucket ships its access logs into the
# audit bucket, under a per-bucket prefix. The audit bucket does not log to
# itself (no meaningful destination) — set enable_access_logging = false
# on it in the calling environment.
resource "aws_s3_bucket_logging" "this" {
  for_each = { for k, v in var.buckets : k => v if v.enable_access_logging && !v.is_audit_bucket }

  bucket        = aws_s3_bucket.this[each.key].id
  target_bucket = local.bucket_names[[for k, v in var.buckets : k if v.is_audit_bucket][0]]
  target_prefix = "s3-access-logs/${each.key}/"
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  for_each = var.buckets

  bucket = aws_s3_bucket.this[each.key].id

  rule {
    id     = "default"
    status = "Enabled"

    filter {}

    dynamic "noncurrent_version_expiration" {
      for_each = each.value.noncurrent_version_expiration_days != null ? [1] : []
      content {
        noncurrent_days = each.value.noncurrent_version_expiration_days
      }
    }

    dynamic "transition" {
      for_each = each.value.transition_ia_days != null ? [1] : []
      content {
        days          = each.value.transition_ia_days
        storage_class = "STANDARD_IA"
      }
    }

    dynamic "transition" {
      for_each = each.value.transition_glacier_days != null ? [1] : []
      content {
        days          = each.value.transition_glacier_days
        storage_class = "GLACIER"
      }
    }

    dynamic "expiration" {
      for_each = each.value.expiration_days != null ? [1] : []
      content {
        days = each.value.expiration_days
      }
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each = var.buckets

  bucket = aws_s3_bucket.this[each.key].id
  policy = data.aws_iam_policy_document.tls_only[each.key].json
}

data "aws_iam_policy_document" "tls_only" {
  for_each = var.buckets

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
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
    resources = ["${aws_s3_bucket.this[each.key].arn}/*"]
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }
}
