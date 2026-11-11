# One api repository per account: STAGING creates it and pushes every release;
# PRODUCTION (create_ecr_repository = false) reads it and deploys the same
# <SHA> images STAGING already ran, without a rebuild.
resource "aws_ecr_repository" "api" {
  count                = var.create_ecr_repository ? 1 : 0
  name                 = "${var.project}/api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Each release pushes two tags: <SHA> (runtime) and <SHA>-migrate. Rule 1 keeps
# the last 10 migrate images. ECR still counts images claimed by a higher-priority
# rule when it evaluates a lower one, so rule 2 counts both kinds: 20 keeps the
# last 10 releases of the app image (rollback targets).
resource "aws_ecr_lifecycle_policy" "api" {
  count      = var.create_ecr_repository ? 1 : 0
  repository = aws_ecr_repository.api[0].name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 10 migrate images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*-migrate"]
          countType      = "imageCountMoreThan"
          countNumber    = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last 10 releases (app and migrate images)"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}

data "aws_ecr_repository" "api" {
  count = var.create_ecr_repository ? 0 : 1
  name  = "${var.project}/api"
}

locals {
  ecr_repository_arn = var.create_ecr_repository ? aws_ecr_repository.api[0].arn : data.aws_ecr_repository.api[0].arn
  ecr_repository_url = var.create_ecr_repository ? aws_ecr_repository.api[0].repository_url : data.aws_ecr_repository.api[0].repository_url
}

# Existing STAGING state: the repository and its policy only gained an index.
moved {
  from = aws_ecr_repository.api
  to   = aws_ecr_repository.api[0]
}

moved {
  from = aws_ecr_lifecycle_policy.api
  to   = aws_ecr_lifecycle_policy.api[0]
}

# PRODUCTION only (origin_domain_name set, #40): Caddy with the Cloudflare DNS
# provider (infra/aws/caddy). Kept apart from the api repository, whose lifecycle
# rule counts every image. Pushed by .github/workflows/caddy-image.yml.
resource "aws_ecr_repository" "caddy" {
  count                = local.origin_tls ? 1 : 0
  name                 = "${var.project}/caddy"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# The host pins one digest (caddy_dns_image); 5 keeps that one and its rollbacks.
resource "aws_ecr_lifecycle_policy" "caddy" {
  count      = local.origin_tls ? 1 : 0
  repository = aws_ecr_repository.caddy[0].name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 5 Caddy images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = { type = "expire" }
      },
    ]
  })
}
