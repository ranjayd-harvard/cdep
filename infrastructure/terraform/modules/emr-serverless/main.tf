# EMR Serverless capable of running the existing Bronze->Silver->Gold
# PyIceberg/pyarrow jobs. No job is submitted by this module or by Phase 12 —
# this only provisions the application, its execution role, and logging so a
# job CAN be submitted later. See docs/aws/lakehouse.md.

resource "aws_emrserverless_application" "lakehouse" {
  name          = "${var.name_prefix}-lakehouse"
  release_label = var.release_label
  type          = "SPARK"

  network_configuration {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  maximum_capacity {
    cpu    = var.max_cpu
    memory = var.max_memory
    disk   = var.max_disk
  }

  auto_start_configuration {
    enabled = true
  }

  auto_stop_configuration {
    enabled              = true
    idle_timeout_minutes = 15
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-lakehouse-emr" })
}

# aws_emrserverless_application has no application-level logging block —
# EMR Serverless logging is configured per job run, via
# `--configuration-overrides '{"monitoringConfiguration":{"cloudWatchLoggingConfiguration":
# {"enabled":true,"logGroupName":"..."}}}'` on each StartJobRun call. This log
# group exists so that config has somewhere to point at; see
# docs/aws/lakehouse.md for the exact job-submission command.
resource "aws_cloudwatch_log_group" "this" {
  name              = "/emr-serverless/${var.name_prefix}-lakehouse"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = merge(var.tags, { Name = "/emr-serverless/${var.name_prefix}-lakehouse" })
}

# --- Job execution role: what the Spark job itself can touch ------------
# Bronze/Silver/Gold read+write in the lakehouse bucket, Glue Catalog
# read+write for the three namespaces, and its own log group. Nothing else —
# specifically no access to the exchange inbound/outbound buckets (those
# belong to data-exchange-service) and no cross-service Secrets Manager
# access.

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["emr-serverless.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "job" {
  name               = "${var.name_prefix}-lakehouse-job-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json

  tags = merge(var.tags, { Name = "${var.name_prefix}-lakehouse-job-role" })
}

data "aws_iam_policy_document" "job" {
  statement {
    sid    = "LakehouseBucketReadWrite"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [var.lakehouse_bucket_arn, "${var.lakehouse_bucket_arn}/*"]
  }

  statement {
    sid    = "GlueCatalogReadWrite"
    effect = "Allow"
    actions = [
      "glue:GetDatabase", "glue:GetDatabases",
      "glue:GetTable", "glue:GetTables", "glue:GetTableVersions",
      "glue:CreateTable", "glue:UpdateTable", "glue:DeleteTable",
      "glue:GetPartition", "glue:GetPartitions", "glue:BatchGetPartition",
      "glue:CreatePartition", "glue:UpdatePartition", "glue:DeletePartition", "glue:BatchCreatePartition",
    ]
    resources = concat(
      ["arn:aws:glue:*:*:catalog"],
      var.glue_database_arns,
      [for arn in var.glue_database_arns : "${arn}/*"],
    )
  }

  statement {
    sid       = "KmsForLakehouseData"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = [var.kms_key_arn]
  }

  statement {
    sid       = "OwnLogGroup"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }
}

resource "aws_iam_role_policy" "job" {
  name   = "${var.name_prefix}-lakehouse-job-policy"
  role   = aws_iam_role.job.id
  policy = data.aws_iam_policy_document.job.json
}
