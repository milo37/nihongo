# One public address for everything: the session cookie is same-origin, so
# /api/*, /health/*, /admin/* and the learner SPA all go to the one container.
# The current image already serves web and admin (apps/api/src/app/staticWeb.ts)
# with the server-side admin guard, so there is no S3 site bucket or OAC: one
# origin, no asset sync or invalidation step, and admin assets stay behind the guard.

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Managed policies only: custom origin request policies are not in the Free/Pro plans.
# Managed, because the flat-rate Free plan has no custom response headers
# policies. Every header is "keep the origin's value", so it only fills in
# responses CloudFront makes itself (WAF 403, origin 5xx pages) (#1015).
data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# With origin TLS, CloudFront uses the forwarded Host as the TLS SNI and checks
# the origin certificate against it. The viewer Host is the site domain, but the
# origin certificate covers only origin_domain_name, so every request got 502
# (JLP-835 first PRODUCTION deploy). This policy sends the origin's own name as
# Host instead. The API does not read Host (auth uses BETTER_AUTH_URL).
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# Only this distribution knows the value, so another account's distribution
# pointed at the EIP gets 403 from the origin proxy and cannot bypass our WAF.
# The value is in Terraform state (CloudFront config needs it), which is why
# state stays on the operator's machine or in an encrypted, private backend.
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "origin_verify" {
  name  = "${local.param_path}/ORIGIN_VERIFY_SECRET"
  type  = "SecureString"
  value = random_password.origin_verify.result
}

# #1183: passage audio straight from its private bucket. Only this distribution
# may read it (bucket policy in audio.tf checks the SourceArn).
resource "aws_cloudfront_origin_access_control" "audio" {
  name                              = "${local.name}-audio"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = local.name
  # The flat-rate plans serve from every edge location; signing STAGING up
  # (2026-11-12) left PriceClass_All, so the code matches it (no cost effect).
  price_class = "PriceClass_All"
  aliases     = var.domain_name != "" ? [var.domain_name] : []
  web_acl_id  = aws_wafv2_web_acl.edge.arn

  origin {
    origin_id   = "api"
    domain_name = local.origin_tls ? var.origin_domain_name : aws_eip.host.public_dns

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }

    # Without origin_domain_name this hop is plain HTTP (no public certificate
    # exists for the EC2 DNS name); setting it switches to HTTPS on 443.
    custom_origin_config {
      http_port              = 3001
      https_port             = 443
      origin_protocol_policy = local.origin_tls ? "https-only" : "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30
    }
  }

  origin {
    origin_id                = "audio"
    domain_name              = aws_s3_bucket.audio.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.audio.id
  }

  default_cache_behavior {
    target_origin_id           = "api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    origin_request_policy_id   = local.origin_tls ? data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id : data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                   = true
  }

  # Hashed learner assets only. /admin/* stays uncached so the admin guard runs.
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  # Content-addressed files (the key is a hash of text, readings and voice), so
  # they cache for as long as the policy allows. Range requests (seeking) pass
  # through to S3.
  ordered_cache_behavior {
    path_pattern               = "/audio/*"
    target_origin_id           = "audio"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.domain_name == ""
    acm_certificate_arn            = var.domain_name != "" ? var.acm_certificate_arn : null
    ssl_support_method             = var.domain_name != "" ? "sni-only" : null
    minimum_protocol_version       = var.domain_name != "" ? "TLSv1.2_2021" : null
  }
}

# Four rules: the Free flat-rate plan allows five.
resource "aws_wafv2_web_acl" "edge" {
  provider = aws.us_east_1
  name     = "${local.name}-edge"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 0
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # Admin content commands can exceed the 8 KB body check; count instead of block.
        # The API caps every body itself (learner 16 KB, sign-in 32 KB, admin per
        # command). A WAF rule that blocks this label outside /api/v1/admin/ is not
        # available on the Free flat-rate plan (#1148).
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-common"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-edge"
    sampled_requests_enabled   = true
  }
}
