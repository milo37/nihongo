resource "aws_security_group" "host" {
  name        = "${local.name}-host"
  description = "Origin proxy port from CloudFront origin-facing addresses only; no SSH (use SSM)."
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_cloudfront" {
  security_group_id = aws_security_group.host.id
  description       = "CloudFront to the origin proxy"
  ip_protocol       = "tcp"
  from_port         = local.origin_port
  to_port           = local.origin_port
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.host.id
  description       = "ECR, SSM, S3, CloudWatch and Google OAuth over HTTPS"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "${local.name}-host"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "host_ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "host_cloudwatch" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/CloudWatchAgentServerPolicy"
}

data "aws_iam_policy_document" "host" {
  statement {
    sid       = "ReadRuntimeParameters"
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.param_path}", "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.param_path}/*"]
  }

  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.api.arn]
  }

  statement {
    sid       = "BackupWriteOnly"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backup.arn}/postgres/*"]
  }

  statement {
    sid       = "ContainerLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }
}

resource "aws_iam_role_policy" "host" {
  name   = "runtime"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host.json
}

resource "aws_iam_instance_profile" "host" {
  name = "${local.name}-host"
  role = aws_iam_role.host.name
}

resource "aws_eip" "host" {
  domain = "vpc"
}

resource "aws_instance" "host" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.host.id]
  iam_instance_profile   = aws_iam_instance_profile.host.name
  monitoring             = false

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gib
    encrypted   = true
  }

  # gzip keeps the rendered cloud-init (scripts + CloudFront CIDR list) under the 16 KB limit.
  user_data_base64 = base64gzip(templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    region          = var.region
    environment     = var.deployment_environment
    param_path      = local.param_path
    data_volume_id  = replace(aws_ebs_volume.data.id, "-", "")
    compose_version = var.compose_version
    compose_sha256  = var.compose_sha256
    log_group       = aws_cloudwatch_log_group.api.name
    ecr_repository  = aws_ecr_repository.api.repository_url
    backup_bucket   = aws_s3_bucket.backup.bucket
    compose_yaml = base64encode(templatefile("${path.module}/files/compose.yaml.tftpl", {
      postgres_image = var.postgres_image
      caddy_image    = var.caddy_image
      origin_port    = local.origin_port
      origin_tls     = local.origin_tls
      proxy_subnet   = local.proxy_subnet
    }))
    caddyfile = base64encode(templatefile("${path.module}/files/Caddyfile.tftpl", {
      origin_domain = var.origin_domain_name
    }))
    deploy_sh         = filebase64("${path.module}/files/deploy.sh")
    render_env_sh     = filebase64("${path.module}/files/render-env.sh")
    backup_sh         = filebase64("${path.module}/files/backup.sh")
    erase_sh          = filebase64("${path.module}/files/erase-deletion-pending.sh")
    cloudwatch_config = base64encode(file("${path.module}/files/cloudwatch-agent.json"))
    public_env = base64encode(join("\n", [
      "NODE_ENV=production",
      "DEPLOYMENT_ENVIRONMENT=${var.deployment_environment}",
      "HOST=0.0.0.0",
      "PORT=3001",
      "LOG_LEVEL=info",
      "ADMIN_CMS_MODE=disabled",
      "TRUSTED_ORIGINS=${local.public_origin}",
      "BETTER_AUTH_URL=${local.public_origin}",
      "AUTH_TRUSTED_PROXY_CIDRS=${local.proxy_subnet}",
      "",
    ]))
  }))

  tags = {
    Name = local.name
  }

  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_eip_association" "host" {
  allocation_id = aws_eip.host.id
  instance_id   = aws_instance.host.id
}

resource "aws_ebs_volume" "data" {
  availability_zone = "${var.region}a"
  type              = "gp3"
  size              = var.data_volume_gib
  encrypted         = true

  tags = {
    Name     = "${local.name}-postgres"
    Snapshot = "${local.name}-weekly"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.host.id
}

# Weekly EBS snapshot of the PostgreSQL volume, four kept.
data "aws_iam_policy_document" "dlm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${local.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "weekly" {
  description        = "${local.name} weekly PostgreSQL volume snapshot"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags = {
      Snapshot = "${local.name}-weekly"
    }

    schedule {
      name = "weekly"
      create_rule {
        cron_expression = "cron(0 18 ? * SUN *)"
      }
      retain_rule {
        count = 4
      }
      copy_tags = true
    }
  }
}
