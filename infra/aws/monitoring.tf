resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# CloudFront metrics are published in us-east-1, so its alarm needs a topic there too.
resource "aws_sns_topic" "alerts_us_east_1" {
  provider = aws.us_east_1
  name     = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_us_east_1_email" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.alerts_us_east_1.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Kept at least as long as the 30-day dumps: after a restore, the account
# erasure requests made since the dump are read back from here (recovery.v1.md).
resource "aws_cloudwatch_log_group" "api" {
  name              = "/${var.project}/${lower(var.deployment_environment)}/api"
  retention_in_days = 30
}

# Ten standard alarms are free per month; this file defines eight.
resource "aws_cloudwatch_metric_alarm" "status_check" {
  alarm_name          = "${local.name}-status-check"
  alarm_description   = "Instance or system status check failed; recover the instance."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.host.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = ["arn:${data.aws_partition.current.partition}:automate:${var.region}:ec2:recover", aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "cpu" {
  alarm_name          = "${local.name}-cpu"
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  dimensions          = { InstanceId = aws_instance.host.id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# t4g is burstable: an empty credit balance means sustained throttling.
resource "aws_cloudwatch_metric_alarm" "cpu_credits" {
  alarm_name          = "${local.name}-cpu-credits"
  namespace           = "AWS/EC2"
  metric_name         = "CPUCreditBalance"
  dimensions          = { InstanceId = aws_instance.host.id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 20
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Memory and disk come from the CloudWatch agent (files/cloudwatch-agent.json).
resource "aws_cloudwatch_metric_alarm" "memory" {
  alarm_name          = "${local.name}-memory"
  namespace           = "CWAgent"
  metric_name         = "mem_used_percent"
  dimensions          = { InstanceId = aws_instance.host.id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "disk" {
  alarm_name          = "${local.name}-disk"
  namespace           = "CWAgent"
  metric_name         = "disk_used_percent"
  dimensions          = { InstanceId = aws_instance.host.id, path = "/var/lib/harumaru", fstype = "ext4" }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Public health signal without a paid health check: origin errors seen by CloudFront.
resource "aws_cloudwatch_metric_alarm" "edge_5xx" {
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-edge-5xx"
  alarm_description   = "API unreachable or failing behind CloudFront."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  dimensions          = { DistributionId = aws_cloudfront_distribution.site.id, Region = "Global" }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  actions_enabled     = !var.host_kept_stopped
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
}

# files/backup.sh publishes 1 after each successful upload; no point in a day = alarm.
resource "aws_cloudwatch_metric_alarm" "backup_missing" {
  alarm_name          = "${local.name}-backup-missing"
  alarm_description   = "No successful pg_dump upload in the last 24 hours."
  namespace           = "Harumaru"
  metric_name         = "BackupSucceeded"
  dimensions          = { Environment = var.deployment_environment }
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  actions_enabled     = !var.host_kept_stopped
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# JLP-843: tell someone when a scheduled erasure or guest cleanup run does not
# succeed. Run Command reports each run as an invocation event; anything that is
# not still running and not Success goes to the alerts topic.
locals {
  scheduled_job_documents = [
    aws_ssm_document.erase_deletion_pending.name,
    aws_ssm_document.guest_cleanup.name,
  ]
}

resource "aws_cloudwatch_event_rule" "scheduled_job_failed" {
  name        = "${local.name}-scheduled-job-failed"
  description = "Account erasure or guest cleanup run ended without Success."
  event_pattern = jsonencode({
    source        = ["aws.ssm"]
    "detail-type" = ["EC2 Command Invocation Status-change Notification"]
    detail = {
      "document-name" = local.scheduled_job_documents
      status          = [{ "anything-but" = ["Pending", "InProgress", "Delayed", "Cancelling", "Success"] }]
    }
  })
}

resource "aws_cloudwatch_event_target" "scheduled_job_failed" {
  rule = aws_cloudwatch_event_rule.scheduled_job_failed.name
  arn  = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      document = "$.detail.document-name"
      status   = "$.detail.status"
      instance = "$.detail.instance-id"
      command  = "$.detail.command-id"
      time     = "$.time"
    }
    input_template = "\"${var.deployment_environment} scheduled job <document> ended <status> at <time> on <instance>. Output: aws ssm get-command-invocation --command-id <command> --instance-id <instance>\""
  }
}

# Replacing the topic policy drops the default one, so the account-owner
# statement (CloudWatch alarms publish under it) is restated here as AWS writes it.
data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid       = "AccountOwner"
    actions   = ["SNS:Publish", "SNS:Subscribe", "SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:AddPermission", "SNS:RemovePermission", "SNS:DeleteTopic", "SNS:ListSubscriptionsByTopic"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid       = "ScheduledJobFailedRule"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.scheduled_job_failed.arn]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

# A run that never reaches Run Command (Scheduler role or target error) leaves
# no invocation event, so watch the Scheduler side too.
resource "aws_cloudwatch_metric_alarm" "scheduler_target_error" {
  alarm_name          = "${local.name}-scheduler-target-error"
  alarm_description   = "EventBridge Scheduler could not start a scheduled job (erasure, guest cleanup or host stop)."
  namespace           = "AWS/Scheduler"
  metric_name         = "TargetErrorCount"
  dimensions          = { ScheduleGroup = "default" }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
