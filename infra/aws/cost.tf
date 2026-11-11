resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(local.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Two stacks in one account: each budget counts only its own environment's
  # tagged cost. Needs the Environment cost allocation tag active (below).
  dynamic "cost_filter" {
    for_each = var.budget_filter_by_environment ? [1] : []
    content {
      name   = "TagKeyValue"
      values = [format("user:Environment$%s", var.deployment_environment)]
    }
  }

  # Gross usage before credits: with credits (Free plan, promotions) the net
  # cost stays 0 and the alerts and the EC2 stop would never fire.
  cost_types {
    include_tax    = false
    include_credit = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# Over budget: stop the only compute. CloudFront then returns 5xx; data stays on EBS.
# Off by default; budget_stop_ec2_enabled = true turns it on (STAGING since the
# paid switch, 2026-11-12).
data "aws_iam_policy_document" "budgets_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "budget_action" {
  count              = var.budget_stop_ec2_enabled ? 1 : 0
  name               = "${local.name}-budget-action"
  assume_role_policy = data.aws_iam_policy_document.budgets_assume.json
}

resource "aws_iam_role_policy_attachment" "budget_action" {
  count      = var.budget_stop_ec2_enabled ? 1 : 0
  role       = aws_iam_role.budget_action[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AWSBudgetsActions_RolePolicyForResourceAdministrationWithSSM"
}

resource "aws_budgets_budget_action" "stop_ec2" {
  count              = var.budget_stop_ec2_enabled ? 1 : 0
  budget_name        = aws_budgets_budget.monthly.name
  action_type        = "RUN_SSM_DOCUMENTS"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budget_action[0].arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    ssm_action_definition {
      action_sub_type = "STOP_EC2_INSTANCES"
      region          = var.region
      instance_ids    = [aws_instance.host.id]
    }
  }

  subscriber {
    address           = var.alert_email
    subscription_type = "EMAIL"
  }
}

resource "aws_ce_anomaly_monitor" "services" {
  count             = var.create_cost_anomaly_monitor ? 1 : 0
  name              = "${local.name}-services"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "daily" {
  count            = var.create_cost_anomaly_monitor ? 1 : 0
  name             = "${local.name}-daily"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services[0].arn]

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.cost_anomaly_threshold_usd)]
    }
  }
}

# Account-wide switch: exactly one stack sets manage_cost_allocation_tag = true.
# Cost Explorer tags cost from activation on (it can take up to 24 hours), so
# activate before a filtered budget relies on it.
resource "aws_ce_cost_allocation_tag" "environment" {
  count   = var.manage_cost_allocation_tag ? 1 : 0
  tag_key = "Environment"
  status  = "Active"
}
