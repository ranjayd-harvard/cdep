# WAF is edge/network-layer protection (common exploit signatures, known-bad
# IPs, request-rate abuse). It is not, and must never be treated as, the
# platform's authorization boundary — that chain (User -> Organization ->
# Tenant -> Entitlement -> Data Product -> Dataset) is enforced in
# application code regardless of what WAF allows through.

resource "aws_wafv2_web_acl" "this" {
  name  = "${var.name_prefix}-waf"
  scope = var.scope

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = { for idx, name in var.managed_rule_groups : name => idx }
    content {
      name     = rule.key
      priority = rule.value

      override_action {
        dynamic "count" {
          for_each = var.enable_blocking ? [] : [1]
          content {}
        }
        dynamic "none" {
          for_each = var.enable_blocking ? [1] : []
          content {}
        }
      }

      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"
        }
      }

      visibility_config {
        sampled_requests_enabled   = true
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name_prefix}-${rule.key}"
      }
    }
  }

  rule {
    name     = "rate-limit"
    priority = length(var.managed_rule_groups) + 1

    action {
      dynamic "block" {
        for_each = var.enable_blocking ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.enable_blocking ? [] : [1]
        content {}
      }
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_requests_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-waf"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-waf" })
}

# WAF logging requires a destination log group name that starts with the
# literal prefix "aws-waf-logs-" — an AWS API requirement, not a convention
# chosen here.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.name_prefix}-${lower(var.scope)}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = merge(var.tags, { Name = "aws-waf-logs-${var.name_prefix}-${lower(var.scope)}" })
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
}
