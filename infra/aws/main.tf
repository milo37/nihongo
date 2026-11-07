locals {
  name       = "${var.project}-${lower(var.deployment_environment)}"
  param_path = "/${var.project}/${lower(var.deployment_environment)}"
  origin_tls = var.origin_domain_name != ""
  # Tax-exclusive USD limit for AWS Budgets, rounded down to the cent.
  monthly_budget_usd = floor(var.monthly_budget_jpy / (1 + var.budget_consumption_tax_rate) / var.budget_jpy_per_usd * 100) / 100
  origin_port        = local.origin_tls ? 443 : 3001
  # Fixed compose subnet: the API trusts only the origin proxy as its peer.
  proxy_subnet  = "172.30.0.0/24"
  db_subnet     = "172.30.1.0/24"
  public_origin = var.domain_name != "" ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.site.domain_name}"

  tags = {
    Project     = var.project
    Environment = var.deployment_environment
    ManagedBy   = "terraform"
  }

  # Secret values are never in Terraform or its state. The operator writes each
  # name below once as a SecureString (see README), and the host reads them at boot.
  secret_parameter_names = [
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "GUEST_COOKIE_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "PRODUCTION_DATABASE_URL",
    "PROD_MIGRATION_LOGIN_PASSWORD",
    "PROD_APP_LOGIN_PASSWORD",
    "PROD_GUEST_CLEANUP_LOGIN_PASSWORD",
  ]

  # Optional, PRODUCTION only: the privacy officer and contact mail on /legal
  # (#705). Kept out of the repository; STAGING leaves them unset.
  legal_parameter_names = [
    "LEGAL_CONTACT_EMAIL",
    "LEGAL_PRIVACY_OFFICER",
  ]
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# Smallest network: the account's default VPC and one default subnet. The host
# needs a public IPv4 because CloudFront VPC origins are not in the Free/Pro plans.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }

  filter {
    name   = "availability-zone"
    values = ["${var.region}a"]
  }
}

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
