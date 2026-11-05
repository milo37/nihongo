locals {
  name          = "${var.project}-${lower(var.deployment_environment)}"
  param_path    = "/${var.project}/${lower(var.deployment_environment)}"
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

# Client IP trust: the API only sees CloudFront as its TCP peer.
data "aws_ip_ranges" "cloudfront" {
  services = ["cloudfront"]
  regions  = ["global"]
}
