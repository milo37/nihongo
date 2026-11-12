# GitHub Actions deploys with short-lived OIDC credentials; no AWS keys in GitHub.
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  # A job with `environment: production` gets sub = ...:environment:production,
  # not the ref. PRODUCTION trusts only that, so only an approved job deploys.
  github_deploy_subject    = var.github_deploy_environment != "" ? "repo:${var.github_repository}:environment:${var.github_deploy_environment}" : "repo:${var.github_repository}:ref:${var.github_deploy_ref}"
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_deploy_subject]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Only the stack that owns the api repository pushes release images.
  dynamic "statement" {
    for_each = var.create_ecr_repository ? [1] : []
    content {
      sid = "EcrPush"
      actions = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
      ]
      resources = [local.ecr_repository_arn]
    }
  }

  # STAGING kept stopped between uses (host_stop_schedule_expression): the
  # deploy job starts this one host first and waits for its SSM agent.
  dynamic "statement" {
    for_each = var.deploy_role_can_start_host ? [1] : []
    content {
      sid       = "StartHost"
      actions   = ["ec2:StartInstances"]
      resources = [aws_instance.host.arn]
    }
  }

  dynamic "statement" {
    for_each = var.deploy_role_can_start_host ? [1] : []
    content {
      sid       = "SeeHostState"
      actions   = ["ec2:DescribeInstances", "ssm:DescribeInstanceInformation"]
      resources = ["*"]
    }
  }

  # Deploy = run the host's deploy document on this one instance.
  statement {
    sid     = "RunDeployOnHost"
    actions = ["ssm:SendCommand"]
    resources = [
      aws_instance.host.arn,
      aws_ssm_document.deploy.arn,
    ]
  }

  statement {
    sid       = "ReadDeployResult"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# PRODUCTION only (#40): the same role pushes the Caddy image. A separate policy
# so the first apply can create the repository and this permission alone
# (-target, README) before the host needs the image digest.
data "aws_iam_policy_document" "github_caddy_push" {
  count = local.origin_tls ? 1 : 0

  # Repeated from the deploy policy: on the first apply (-target) that policy
  # does not exist yet, and docker login needs this before any push.
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushCaddy"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [aws_ecr_repository.caddy[0].arn]
  }
}

resource "aws_iam_role_policy" "github_caddy_push" {
  count  = local.origin_tls ? 1 : 0
  name   = "caddy-push"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_caddy_push[0].json
}
