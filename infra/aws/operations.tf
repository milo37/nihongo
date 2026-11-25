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
      # STAGING kept stopped between uses: stop the host this many minutes
      # after a deploy (a later deploy moves it). 0 = leave it running.
      stopAfterMinutes = {
        type           = "String"
        default        = "0"
        allowedPattern = "^(0|[1-9][0-9]{0,3})$"
      }
      # #1182: loadFurigana only previews (dryRun) unless this says load.
      furiganaLoad = {
        type          = "String"
        default       = "dryRun"
        allowedValues = ["dryRun", "load"]
      }
    }
    mainSteps = [
      # #1046: render-env.sh is a cloud-init file, which running hosts never
      # reread (#1042). Write the repository copy before each deploy, so a new
      # parameter (WEB_PUSH_PUBLIC_KEY in api.env) reaches the API with the next
      # release instead of the next host replacement.
      {
        action = "aws:runShellScript"
        name   = "refreshRenderEnv"
        inputs = {
          timeoutSeconds = "60"
          runCommand = [
            "set -euo pipefail",
            "echo '${base64encode(file("${path.module}/files/render-env.sh"))}' | base64 -d > /opt/harumaru/bin/render-env.sh.new",
            "chmod 0750 /opt/harumaru/bin/render-env.sh.new",
            "mv -f /opt/harumaru/bin/render-env.sh.new /opt/harumaru/bin/render-env.sh",
          ]
        }
      },
      {
        action = "aws:runShellScript"
        name   = "deploy"
        inputs = {
          timeoutSeconds = "900"
          runCommand     = ["/opt/harumaru/bin/deploy.sh {{ releaseId }}"]
        }
      },
      # #1043: load the rush word list (content/rush/kanji-words.v1.json in the
      # API image) as soon as the release is live. One transaction; the same
      # file again changes nothing. A failed load fails the deploy command and
      # leaves the table as it was. Here and not in deploy.sh: host files change
      # only on a new host (#1042). Skipped when this release is not live (the
      # deploy step already failed or rolled back).
      {
        action = "aws:runShellScript"
        name   = "loadRushWords"
        inputs = {
          timeoutSeconds = "300"
          runCommand = [
            "cd /opt/harumaru",
            "[ \"$(cat current-release 2>/dev/null || true)\" = '{{ releaseId }}' ] || { echo 'rush words not loaded: release not live'; exit 0; }",
            "docker compose --profile operator run --rm --no-deps -T -e RUSH_WORD_LIST_FILE=/app/content/rush/kanji-words.v1.json -e RUSH_WORD_LOAD_CONFIRM=LOAD_RUSH_WORDS --entrypoint node capability api/dist/content/rushWordLoadCommand.js",
          ]
        }
      },
      # #1182: the reviewed passage furigana (content/furigana/reading-passages.v1.json
      # in the API image), the same way as the rush words. By default only the
      # preview line furigana_list_dry_run (nothing written); furiganaLoad=load
      # writes it in one transaction. Skipped when this release is not live.
      {
        action = "aws:runShellScript"
        name   = "loadFurigana"
        inputs = {
          timeoutSeconds = "300"
          runCommand = [
            "cd /opt/harumaru",
            "[ \"$(cat current-release 2>/dev/null || true)\" = '{{ releaseId }}' ] || { echo 'furigana not loaded: release not live'; exit 0; }",
            "confirm=''; [ '{{ furiganaLoad }}' = load ] && confirm='-e FURIGANA_LOAD_CONFIRM=LOAD_FURIGANA'",
            "docker compose --profile operator run --rm --no-deps -T -e FURIGANA_LIST_FILE=/app/content/furigana/reading-passages.v1.json $confirm --entrypoint node capability api/dist/content/furiganaLoadCommand.js",
          ]
        }
      },
      # Each deploy pulls a ~540 MB API image and nothing removed the old ones,
      # so the 20 GB root disk filled up (STAGING, run 44024084136). Keep the
      # live release and the newest other image (the rollback target after a
      # success, the failed image after a failure); ECR keeps every tag. This
      # step also runs after a failed deploy. Here and not in deploy.sh: host
      # files change only on a new host (#1042). Images only, never volumes.
      {
        action = "aws:runShellScript"
        name   = "pruneImages"
        inputs = {
          timeoutSeconds = "120"
          runCommand = [
            "source /etc/harumaru/host.env",
            "live=$(cat /opt/harumaru/current-release 2>/dev/null || true)",
            "[ -n \"$live\" ] || exit 0",
            "docker image ls \"$ECR_REPOSITORY\" | awk 'NR > 1 {print $2}' | grep -E '^[0-9a-f]{40}$' | grep -vx \"$live\" | tail -n +2 | sed \"s|^|$ECR_REPOSITORY:|\" | xargs -r docker image rm >/dev/null || true",
            "df -h / | awk 'NR==2 {print \"disk free \" $4 \" (\" $5 \" used)\"}'",
          ]
        }
      },
      {
        action = "aws:runShellScript"
        name   = "stopLater"
        inputs = {
          timeoutSeconds = "60"
          runCommand = [
            "minutes={{ stopAfterMinutes }}",
            "[ \"$minutes\" -gt 0 ] || exit 0",
            "shutdown -c 2>/dev/null || true",
            "shutdown -h \"+$minutes\"",
            "echo \"host stops in $minutes minutes\"",
          ]
        }
      },
    ]
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

# #694 guest data cleanup: guest sessions and principals 7 days after expiry,
# replay records and rate-limit rows (files/guest-cleanup.sh). DISABLED until
# guest_cleanup_schedule_enabled is set; hourly because one run stops at 1,000 rows.
resource "aws_ssm_document" "guest_cleanup" {
  name            = "${local.name}-guest-cleanup"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Run the guest data cleanup once."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "cleanup"
      inputs = {
        timeoutSeconds = "300"
        runCommand     = ["/opt/harumaru/bin/guest-cleanup.sh"]
      }
    }]
  })
}

# #1042 daily return-rate count (files/retention-cohort.sh). The document carries
# the script lines itself, so running hosts get it with apply alone (no user data
# change, no restart). DISABLED until retention_schedule_enabled is set, after
# the release with its migration is deployed.
resource "aws_ssm_document" "retention_cohort" {
  name            = "${local.name}-retention-cohort"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Count next-day and 7-day return rates once."
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "count"
      inputs = {
        timeoutSeconds = "300"
        runCommand     = split("\n", trimspace(file("${path.module}/files/retention-cohort.sh")))
      }
    }]
  })
}

# #671 retention cleanups (files/cleanup-job.sh): one document, the job and the
# dry-run switch as parameters with fixed allowed values. The parameter lines go
# in front of the script lines, so apply alone updates running hosts.
resource "aws_ssm_document" "cleanup" {
  name            = "${local.name}-cleanup"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Run one retention cleanup once."
    parameters = {
      job = {
        type          = "String"
        allowedValues = keys(var.cleanup_schedules)
      }
      dryRun = {
        type          = "String"
        default       = "true"
        allowedValues = ["true", "false"]
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "cleanup"
      inputs = {
        timeoutSeconds = "300"
        runCommand = concat(
          ["job='{{ job }}'", "dry_run='{{ dryRun }}'"],
          split("\n", trimspace(file("${path.module}/files/cleanup-job.sh")))
        )
      }
    }]
  })
}

# #1046 daily web push (files/daily-push.sh) at 08:00 Korea time. The send and
# subject lines go in front of the script lines, so apply alone updates running
# hosts. DISABLED until daily_push_schedule_enabled is set, after the VAPID key
# parameters exist; STAGING keeps it off (its host is stopped at 08:00).
resource "aws_ssm_document" "daily_push" {
  name            = "${local.name}-daily-push"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Send the daily web push once (send=false only counts)."
    parameters = {
      send = {
        type          = "String"
        default       = "false"
        allowedValues = ["true", "false"]
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "push"
      inputs = {
        timeoutSeconds = "600"
        runCommand = concat(
          ["send='{{ send }}'", "WEB_PUSH_SUBJECT='${local.public_origin}'"],
          split("\n", trimspace(file("${path.module}/files/daily-push.sh")))
        )
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
      aws_ssm_document.guest_cleanup.arn,
      aws_ssm_document.retention_cohort.arn,
      aws_ssm_document.cleanup.arn,
      aws_ssm_document.daily_push.arn,
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

resource "aws_scheduler_schedule" "guest_cleanup" {
  name                         = "${local.name}-guest-cleanup"
  state                        = var.guest_cleanup_schedule_enabled ? "ENABLED" : "DISABLED"
  schedule_expression          = var.guest_cleanup_schedule_expression
  schedule_expression_timezone = "Asia/Tokyo"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ssm:sendCommand"
    role_arn = aws_iam_role.erasure_scheduler.arn
    input = jsonencode({
      DocumentName = aws_ssm_document.guest_cleanup.name
      InstanceIds  = [aws_instance.host.id]
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_scheduler_schedule" "retention_cohort" {
  name                         = "${local.name}-retention-cohort"
  state                        = var.retention_schedule_enabled ? "ENABLED" : "DISABLED"
  schedule_expression          = var.retention_schedule_expression
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ssm:sendCommand"
    role_arn = aws_iam_role.erasure_scheduler.arn
    input = jsonencode({
      DocumentName = aws_ssm_document.retention_cohort.name
      InstanceIds  = [aws_instance.host.id]
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_scheduler_schedule" "cleanup" {
  for_each                     = var.cleanup_schedules
  name                         = "${local.name}-cleanup-${each.key}"
  state                        = each.value.enabled ? "ENABLED" : "DISABLED"
  schedule_expression          = each.value.expression
  schedule_expression_timezone = "Asia/Tokyo"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ssm:sendCommand"
    role_arn = aws_iam_role.erasure_scheduler.arn
    input = jsonencode({
      DocumentName = aws_ssm_document.cleanup.name
      InstanceIds  = [aws_instance.host.id]
      Parameters = {
        job    = [each.key]
        dryRun = [each.value.dry_run ? "true" : "false"]
      }
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_scheduler_schedule" "daily_push" {
  name                         = "${local.name}-daily-push"
  state                        = var.daily_push_schedule_enabled ? "ENABLED" : "DISABLED"
  schedule_expression          = var.daily_push_schedule_expression
  schedule_expression_timezone = "Asia/Seoul"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ssm:sendCommand"
    role_arn = aws_iam_role.erasure_scheduler.arn
    input = jsonencode({
      DocumentName = aws_ssm_document.daily_push.name
      InstanceIds  = [aws_instance.host.id]
      Parameters   = { send = ["true"] }
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

# STAGING between uses (owner decision b): stop the host on a schedule. The
# deploy job starts it again (deploy_role_can_start_host). Empty = no schedule.
# With host_start_schedule_expression the host also wakes once a day so the
# erasure and guest cleanup schedules (set to the same window) reach it.
data "aws_iam_policy_document" "host_stop" {
  count = var.host_stop_schedule_expression != "" ? 1 : 0
  statement {
    actions   = ["ec2:StopInstances"]
    resources = [aws_instance.host.arn]
  }
}

resource "aws_iam_role" "host_stop" {
  count              = var.host_stop_schedule_expression != "" ? 1 : 0
  name               = "${local.name}-host-stop"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "host_stop" {
  count  = var.host_stop_schedule_expression != "" ? 1 : 0
  name   = "stop-host"
  role   = aws_iam_role.host_stop[0].id
  policy = data.aws_iam_policy_document.host_stop[0].json
}

resource "aws_scheduler_schedule" "host_stop" {
  count                        = var.host_stop_schedule_expression != "" ? 1 : 0
  name                         = "${local.name}-host-stop"
  schedule_expression          = var.host_stop_schedule_expression
  schedule_expression_timezone = "Asia/Tokyo"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.host_stop[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.host.id] })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

data "aws_iam_policy_document" "host_start" {
  count = var.host_start_schedule_expression != "" ? 1 : 0
  statement {
    actions   = ["ec2:StartInstances"]
    resources = [aws_instance.host.arn]
  }
}

resource "aws_iam_role" "host_start" {
  count              = var.host_start_schedule_expression != "" ? 1 : 0
  name               = "${local.name}-host-start"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "host_start" {
  count  = var.host_start_schedule_expression != "" ? 1 : 0
  name   = "start-host"
  role   = aws_iam_role.host_start[0].id
  policy = data.aws_iam_policy_document.host_start[0].json
}

resource "aws_scheduler_schedule" "host_start" {
  count                        = var.host_start_schedule_expression != "" ? 1 : 0
  name                         = "${local.name}-host-start"
  schedule_expression          = var.host_start_schedule_expression
  schedule_expression_timezone = "Asia/Tokyo"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.host_start[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.host.id] })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
