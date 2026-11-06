variable "project" {
  description = "Resource name prefix."
  type        = string
  default     = "harumaru"
}

variable "region" {
  description = "Primary region (user decision 2026-11-05: Seoul)."
  type        = string
  default     = "ap-northeast-2"
}

variable "deployment_environment" {
  description = "DEPLOYMENT_ENVIRONMENT for the API. No default: STAGING or PRODUCTION is an owner decision."
  type        = string

  validation {
    condition     = contains(["STAGING", "PRODUCTION"], var.deployment_environment)
    error_message = "deployment_environment must be STAGING or PRODUCTION."
  }
}

variable "instance_type" {
  description = "Single API + PostgreSQL host (Graviton)."
  type        = string
  default     = "t4g.small"

  validation {
    condition     = startswith(var.instance_type, "t4g.")
    error_message = "Use a t4g (arm64) instance type; the AMI and Compose binary are arm64."
  }
}

variable "root_volume_gib" {
  type    = number
  default = 20
}

variable "data_volume_gib" {
  description = "Separate gp3 volume for PostgreSQL data; survives instance replacement."
  type        = number
  default     = 10
}

variable "domain_name" {
  description = "Custom domain (for example harumaru.net). Empty = use the *.cloudfront.net address."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "us-east-1 ACM certificate for domain_name. Required only when domain_name is set."
  type        = string
  default     = ""

  validation {
    condition     = var.domain_name == "" || startswith(var.acm_certificate_arn, "arn:aws:acm:us-east-1:")
    error_message = "A custom domain needs a us-east-1 ACM certificate ARN."
  }
}

variable "origin_domain_name" {
  description = "Origin hostname with a public certificate (for example origin.harumaru.net). Empty = HTTP origin on 3001 (no TLS on the CloudFront to EC2 hop)."
  type        = string
  default     = ""

  validation {
    condition     = var.deployment_environment != "PRODUCTION" || var.origin_domain_name != ""
    error_message = "PRODUCTION requires origin_domain_name: the CloudFront to EC2 hop must use TLS."
  }
}

variable "caddy_image" {
  description = "Origin proxy that checks the CloudFront secret header."
  type        = string
  default     = "caddy:2.11.8-alpine@sha256:f6228111e5fafa1a5238258d0858e103f10599b8d1659a146e7726681a002bb9"
}

variable "waf_rate_limit_per_5min" {
  description = "Requests per client IP per 5 minutes before WAF blocks."
  type        = number
  default     = 1000
}

variable "alert_email" {
  description = "Receives CloudWatch alarm, budget and cost anomaly mail (subscription must be confirmed)."
  type        = string
}

# AWS Budgets only takes USD. The owner sets the limit in JPY including
# consumption tax, so: limit_usd = monthly_budget_jpy / (1 + tax) / jpy_per_usd.
# The budget compares tax-exclusive cost (include_tax = false), because tax is
# only added when the invoice is issued. Update jpy_per_usd when the yen moves.
variable "monthly_budget_jpy" {
  description = "Monthly limit in JPY, consumption tax included (owner decision 2026-11-05)."
  type        = number
  default     = 5000
}

variable "budget_jpy_per_usd" {
  description = "Exchange-rate assumption for the USD budget (open.er-api.com, 2026-11-05)."
  type        = number
  default     = 158.38
}

variable "budget_consumption_tax_rate" {
  description = "Japanese consumption tax assumed on the AWS Japan invoice."
  type        = number
  default     = 0.10
}

variable "budget_stop_ec2_enabled" {
  # Off while the account is on the AWS Free plan (credits, no cash bill): usage
  # runs above the limit there and the stop would take the site down every month.
  # Set true in terraform.tfvars when switching to the paid plan (README).
  description = "Stop the EC2 host automatically when actual cost reaches 100% of the budget."
  type        = bool
  default     = false
}

variable "create_cost_anomaly_monitor" {
  description = "AWS allows one SERVICE anomaly monitor per account; set false if the console already created it."
  type        = bool
  default     = true
}

variable "cost_anomaly_threshold_usd" {
  type    = number
  default = 5
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role."
  type        = string
  default     = "milo37/nihongo"
}

variable "github_deploy_ref" {
  description = "Only this ref may assume the deploy role."
  type        = string
  default     = "refs/heads/main"
}

variable "create_github_oidc_provider" {
  description = "Set false if the account already has the token.actions.githubusercontent.com provider."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

variable "erasure_schedule_enabled" {
  description = "Account erasure (#57) hourly schedule. Set true at apply (#670); false creates it DISABLED."
  type        = bool
  default     = false
}

variable "erasure_schedule_expression" {
  type    = string
  default = "cron(0 * * * ? *)"
}

variable "guest_cleanup_schedule_enabled" {
  description = "Guest data cleanup (#694). Off until the owner switches it on with the first deploy."
  type        = bool
  default     = false
}

variable "guest_cleanup_schedule_expression" {
  type    = string
  default = "cron(30 * * * ? *)"
}

variable "compose_version" {
  type    = string
  default = "v5.7.0"
}

variable "compose_sha256" {
  description = "sha256 of docker-compose-linux-aarch64 from the release checksums.txt."
  type        = string
  default     = "15861535d14e26555736b49376c95e14bfd94285366c8446bfac7156a972e76f"
}

variable "postgres_image" {
  description = "Same major/minor as compose.yaml."
  type        = string
  default     = "postgres:18.4-alpine"
}
