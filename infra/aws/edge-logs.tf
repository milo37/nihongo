# CloudFront access logs and WAF block alarms (#1005). On by default for
# PRODUCTION only (user decision 2026-11-14).
# - The privacy policy keeps data in Seoul, so the access logs go to an S3
#   bucket in var.region (standard logging v2, set up in us-east-1 with cross
#   Region delivery; S3 delivery has no logging charge). WAF logs are not kept:
#   CloudFront-scope WAF logs can only reach CloudWatch Logs in us-east-1.
# - Query string, cookies and referer are left out of the record (sign-in codes
#   and tokens can ride in them). The bucket deletes logs after
#   var.edge_log_retention_days.
# - WAF block counts are free metrics already on; two alarms watch them.
locals {
  edge_logging = coalesce(var.edge_logging_enabled, var.deployment_environment == "PRODUCTION")
  edge_log_fields = [
    "date", "time", "x-edge-location", "sc-bytes", "c-ip", "cs-method", "cs(Host)",
    "cs-uri-stem", "sc-status", "cs(User-Agent)", "x-edge-result-type",
    "x-edge-request-id", "x-host-header", "cs-protocol", "cs-bytes", "time-taken",
    "x-forwarded-for", "ssl-protocol", "ssl-cipher", "x-edge-response-result-type",
    "cs-protocol-version", "c-port", "time-to-first-byte",
    "x-edge-detailed-result-type", "sc-content-type", "sc-content-len", "c-country",
  ]
}

resource "aws_s3_bucket" "edge_logs" {
  count  = local.edge_logging ? 1 : 0
  bucket = "${local.name}-edge-logs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "edge_logs" {
  count                   = local.edge_logging ? 1 : 0
  bucket                  = aws_s3_bucket.edge_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "edge_logs" {
  count  = local.edge_logging ? 1 : 0
  bucket = aws_s3_bucket.edge_logs[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "edge_logs" {
  count  = local.edge_logging ? 1 : 0
  bucket = aws_s3_bucket.edge_logs[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "edge_logs" {
  count  = local.edge_logging ? 1 : 0
  bucket = aws_s3_bucket.edge_logs[0].id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {
      prefix = "AWSLogs/"
    }
    expiration {
      days = var.edge_log_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "edge_logs" {
  count = local.edge_logging ? 1 : 0

  statement {
    sid       = "AWSLogDeliveryWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.edge_logs[0].arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/CloudFront/*"]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"]
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.edge_logs[0].arn,
      "${aws_s3_bucket.edge_logs[0].arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "edge_logs" {
  count  = local.edge_logging ? 1 : 0
  bucket = aws_s3_bucket.edge_logs[0].id
  policy = data.aws_iam_policy_document.edge_logs[0].json
}

resource "aws_cloudwatch_log_delivery_source" "edge" {
  count        = local.edge_logging ? 1 : 0
  provider     = aws.us_east_1
  name         = "${local.name}-edge-access"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudwatch_log_delivery_destination" "edge" {
  count         = local.edge_logging ? 1 : 0
  provider      = aws.us_east_1
  name          = "${local.name}-edge-access-s3"
  output_format = "w3c"
  delivery_destination_configuration {
    destination_resource_arn = aws_s3_bucket.edge_logs[0].arn
  }
}

resource "aws_cloudwatch_log_delivery" "edge" {
  count                    = local.edge_logging ? 1 : 0
  provider                 = aws.us_east_1
  delivery_source_name     = aws_cloudwatch_log_delivery_source.edge[0].name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.edge[0].arn
  record_fields            = local.edge_log_fields
  # The bucket policy must allow the writer before the first delivery.
  depends_on = [aws_s3_bucket_policy.edge_logs]
}

# All WAF blocks in 5 minutes. PRODUCTION peak 2026-11-12..14 was 312.
resource "aws_cloudwatch_metric_alarm" "waf_blocked_spike" {
  count               = local.edge_logging ? 1 : 0
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-waf-blocked-spike"
  alarm_description   = "WAF blocked an unusual number of requests (scan or attack). Check the edge access logs (status 403)."
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = aws_wafv2_web_acl.edge.name, Rule = "ALL" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.waf_blocked_alarm_per_5min
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
}

# The per-IP rate limit blocking many requests means one client is flooding.
resource "aws_cloudwatch_metric_alarm" "waf_rate_limited" {
  count               = local.edge_logging ? 1 : 0
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-waf-rate-limited"
  alarm_description   = "WAF per-IP rate limit is blocking a client. Check the edge access logs for its address."
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = aws_wafv2_web_acl.edge.name, Rule = "rate-limit-per-ip" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.waf_rate_limited_alarm_per_5min
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
}
