output "site_url" {
  value = local.public_origin
}

output "cloudfront_domain_name" {
  description = "Point the custom domain's CNAME here once it exists."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "google_oauth_redirect_uri" {
  description = "Register this exact URI in the Google OAuth client."
  value       = "${local.public_origin}/api/auth/callback/google"
}

output "ecr_repository_url" {
  value = local.ecr_repository_url
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "instance_id" {
  value = aws_instance.host.id
}

output "deploy_document" {
  value = aws_ssm_document.deploy.name
}

output "backup_bucket" {
  value = aws_s3_bucket.backup.bucket
}

output "secret_parameter_names" {
  description = "Write each as a SecureString before the first deploy (values never go through Terraform)."
  value       = [for name in local.secret_parameter_names : "${local.param_path}/${name}"]
}

output "legal_parameter_names" {
  description = "Optional; write both before PRODUCTION opens (production-database runbook, Legal contact)."
  value       = [for name in local.legal_parameter_names : "${local.param_path}/${name}"]
}

# PRODUCTION only (null in STAGING): set as the GitHub variable CADDY_ECR_REPOSITORY_URL.
output "caddy_ecr_repository_url" {
  value = try(aws_ecr_repository.caddy[0].repository_url, null)
}
