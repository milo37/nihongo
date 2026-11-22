# #1183: passage read-aloud audio. Private bucket; the API reads it with the
# host role and serves it through the existing app route (no CDN origin).
# Objects live under audio/passages/<cache key>.(mp3|marks.json); the cache key is a
# hash of passage text, readings, voice, engine and generator version, so a new
# version writes new keys and never overwrites what the app is serving.
resource "aws_s3_bucket" "audio" {
  bucket = "${local.name}-audio-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "audio_tls_only" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.audio.arn,
      "${aws_s3_bucket.audio.arn}/*",
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

resource "aws_s3_bucket_policy" "audio" {
  bucket = aws_s3_bucket.audio.id
  policy = data.aws_iam_policy_document.audio_tls_only.json
}

# Read only for the API; it never gets Polly.
data "aws_iam_policy_document" "host_audio_read" {
  statement {
    sid       = "ReadPassageAudio"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.audio.arn}/audio/passages/*"]
  }
}

resource "aws_iam_role_policy" "host_audio_read" {
  name   = "audio-read"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host_audio_read.json
}

# Generation runs from a GitHub Actions job (same OIDC subject as deploy, so
# PRODUCTION generation needs the approved production environment). Only this
# role may call Polly, and only in the Tokyo region the voice was chosen in.
resource "aws_iam_role" "audio_generator" {
  name                 = "${local.name}-audio-generator"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "audio_generator" {
  statement {
    sid       = "Synthesize"
    actions   = ["polly:SynthesizeSpeech"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.audio_polly_region]
    }
  }

  # GetObject lets the job HEAD a key and skip it; no ListBucket, so a missing
  # key answers 403 rather than 404.
  statement {
    sid       = "WritePassageAudio"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.audio.arn}/audio/passages/*"]
  }
}

resource "aws_iam_role_policy" "audio_generator" {
  name   = "generate"
  role   = aws_iam_role.audio_generator.id
  policy = data.aws_iam_policy_document.audio_generator.json
}
