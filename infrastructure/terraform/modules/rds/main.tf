# Never publicly accessible, never encrypted with anything but a customer
# key, and always inside the private DATA subnets — these are not toggles.
# See docs/aws/security.md for why `publicly_accessible` isn't even exposed
# as a variable here.

resource "aws_db_subnet_group" "this" {
  name       = "${var.identifier}-subnet-group"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, { Name = "${var.identifier}-subnet-group" })
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.identifier}-pg"
  family = var.parameter_group_family

  dynamic "parameter" {
    for_each = var.parameters
    content {
      name         = parameter.value.name
      value        = parameter.value.value
      apply_method = parameter.value.apply_method
    }
  }

  # force_ssl is not optional: application connections must use TLS.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(var.tags, { Name = "${var.identifier}-pg" })
}

resource "aws_db_instance" "this" {
  identifier     = var.identifier
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn

  db_name  = var.database_name
  username = var.master_username
  # No password on this resource at all: RDS generates and stores it in
  # Secrets Manager natively. Nothing secret ever enters a .tf file, a
  # variable default, or (beyond the ARN reference) Terraform state.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  parameter_group_name   = aws_db_parameter_group.this.name
  vpc_security_group_ids = var.vpc_security_group_ids
  publicly_accessible    = false

  multi_az = var.multi_az

  backup_retention_period = var.backup_retention_period
  backup_window           = var.backup_window
  maintenance_window      = var.maintenance_window
  copy_tags_to_snapshot   = true

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.identifier}-final-${formatdate("YYYYMMDD-hhmmss", timestamp())}"
  apply_immediately         = var.apply_immediately

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_retention_period = var.performance_insights_enabled ? var.performance_insights_retention_days : null
  performance_insights_kms_key_id       = var.performance_insights_enabled ? var.kms_key_arn : null

  monitoring_interval = var.monitoring_interval_seconds
  monitoring_role_arn = var.monitoring_interval_seconds > 0 ? var.monitoring_role_arn : null

  auto_minor_version_upgrade = true

  # Query/error/upgrade logs to CloudWatch — independent of, and in addition
  # to, application-level logging.
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Available as a second, token-based auth path alongside the RDS-managed
  # master password (docs/aws/database.md) — enabling it costs nothing and
  # doesn't change how the application connects today; it only becomes
  # meaningful once/if a database user is explicitly mapped to an IAM role.
  iam_database_authentication_enabled = true

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [final_snapshot_identifier]
  }

  tags = merge(var.tags, { Name = var.identifier })
}
