# Deploy: migrations first, then the API restarts; a failed health check rolls
# back to the previous image (files/deploy.sh).
resource "aws_ssm_document" "deploy" {
  name            = "${local.name}-deploy"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy one API release (full git SHA) on the host."
    parameters = {
      releaseId = {
        type           = "String"
        allowedPattern = "^[0-9a-f]{40}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "900"
        runCommand     = ["/opt/harumaru/bin/deploy.sh {{ releaseId }}"]
      }
    }]
  })
}

# #57 account erasure: the one-shot auth:erase-deletion-pending:compiled command
# runs from the deployed image on the host, hourly once erasure_schedule_enabled
# is true (operations/runbooks/account-erasure.v2.md). Since #696 it records
# provider cleanup as NOT_HELD (no stored tokens) and runs on PRODUCTION.
resource "aws_ssm_document" "erase_deletion_pending" {
  name            = "${local.name}-erase-deletion-pending"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Run the provider-first account erasure queue once."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "erase"
      inputs = {
        timeoutSeconds = "1800"
        runCommand     = ["/opt/harumaru/bin/erase-deletion-pending.sh"]
      }
    }]
  })
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "erasure_scheduler" {
  name               = "${local.name}-erasure-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "erasure_scheduler" {
  statement {
    actions = ["ssm:SendCommand"]
    resources = [
      aws_instance.host.arn,
      aws_ssm_document.erase_deletion_pending.arn,
    ]
  }
}

resource "aws_iam_role_policy" "erasure_scheduler" {
  name   = "send-erase-command"
  role   = aws_iam_role.erasure_scheduler.id
  policy = data.aws_iam_policy_document.erasure_scheduler.json
}

resource "aws_scheduler_schedule" "erase_deletion_pending" {
  name                         = "${local.name}-erase-deletion-pending"
  state                        = var.erasure_schedule_enabled ? "ENABLED" : "DISABLED"
  schedule_expression          = var.erasure_schedule_expression
  schedule_expression_timezone = "Asia/Tokyo"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ssm:sendCommand"
    role_arn = aws_iam_role.erasure_scheduler.arn
    input = jsonencode({
      DocumentName = aws_ssm_document.erase_deletion_pending.name
      InstanceIds  = [aws_instance.host.id]
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
