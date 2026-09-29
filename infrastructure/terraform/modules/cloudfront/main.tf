data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  price_class     = var.price_class
  aliases         = var.domain_aliases
  web_acl_id      = var.web_acl_arn
  comment         = "${var.name_prefix} customer portal / product API edge"

  origin {
    domain_name = var.alb_dns_name
    origin_id   = "${var.name_prefix}-alb-origin"

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "${var.name_prefix}-alb-origin"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    # Origin-request policy forwards everything through: this fronts a
    # dynamic, authenticated application (session cookies, Authorization
    # headers, query strings all matter), not a static asset origin.
    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Host", "Origin", "Referer"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = var.min_ttl
    default_ttl = var.default_ttl
    max_ttl     = var.max_ttl
  }

  dynamic "logging_config" {
    for_each = var.logging_bucket_domain_name != null ? [1] : []
    content {
      bucket          = var.logging_bucket_domain_name
      prefix          = "cloudfront-access-logs/"
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == null
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = var.certificate_arn != null ? "sni-only" : null
    minimum_protocol_version       = var.certificate_arn != null ? "TLSv1.2_2021" : null
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-cloudfront" })
}
