# Operator access record (JLP-842): who did what in this AWS account, including
# SSM sessions to the host (the only way to reach the database by hand), kept at
# least one year. One trail per account, like ECR: STAGING creates it
# (create_account_trail = true), PRODUCTION leaves it false. A second trail of
# the same management events would be billed; the first copy is free.
locals {
  trail_name = "${var.project}-account-trail"
}

resource "aws_s3_bucket" "audit" {
  count  = var.create_account_trail ? 1 : 0
  bucket = "${var.project}-audit-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audit" {
  count                   = var.create_account_trail ? 1 : 0
  bucket                  = aws_s3_bucket.audit[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audit" {
  count  = var.create_account_trail ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  count  = var.create_account_trail ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  count  = var.create_account_trail ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id

  rule {
    id     = "expire-audit-logs"
    status = "Enabled"
    filter {
      prefix = "AWSLogs/"
    }
    expiration {
      days = var.audit_log_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "audit" {
  count = var.create_account_trail ? 1 : 0

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.audit[0].arn,
      "${aws_s3_bucket.audit[0].arn}/*",
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

  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit[0].arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:${var.region}:${data.aws_caller_identity.current.account_id}:trail/${local.trail_name}"]
    }
  }

  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit[0].arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:${var.region}:${data.aws_caller_identity.current.account_id}:trail/${local.trail_name}"]
    }
  }
}

resource "aws_s3_bucket_policy" "audit" {
  count  = var.create_account_trail ? 1 : 0
  bucket = aws_s3_bucket.audit[0].id
  policy = data.aws_iam_policy_document.audit[0].json
}

# Management events only (read and write), every region, global services (IAM,
# STS, console sign-in) included. Data events stay off: they are billed per event.
resource "aws_cloudtrail" "account" {
  count                         = var.create_account_trail ? 1 : 0
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.audit[0].id
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  depends_on = [aws_s3_bucket_policy.audit]
}
