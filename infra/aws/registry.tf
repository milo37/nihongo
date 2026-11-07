resource "aws_ecr_repository" "api" {
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
  repository = aws_ecr_repository.api.name
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
