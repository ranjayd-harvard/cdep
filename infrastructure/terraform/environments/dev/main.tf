# Environment composition: wires the reusable modules in ../../modules into
# one deployable stack. This file is intentionally near-identical across
# dev/staging/production (see environments/staging, environments/production)
# — per-environment behavior comes from terraform.tfvars, not from
# duplicating this wiring. See infrastructure/terraform/README.md.

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
    },
    var.tags,
  )

  # --- Backend services that own a Postgres database ---------------------
  # data-lakehouse is deliberately absent: its local Postgres was only the
  # PyIceberg SqlCatalog metadata store, which AWS Glue Data Catalog
  # replaces outright (see modules/glue and docs/aws/lakehouse.md) — no RDS
  # instance is needed for it.
  rds_services = {
    "exchange-service"           = { db_name = "exchange" }
    "catalog-service"            = { db_name = "catalog" }
    "subscription-service"       = { db_name = "subscription" }
    "scheduler-service"          = { db_name = "scheduler" }
    "publication-service"        = { db_name = "publication" }
    "observability-service"      = { db_name = "observability" }
    "serving-projection-service" = { db_name = "serving" }
  }

  # --- ECS services --------------------------------------------------------
  # Ports and health paths come from docs/aws/current-state-inventory.md.
  # `public = true` gets an ALB listener rule; everything else is reachable
  # only from other ECS tasks (modules/security ecs_internal boundary) and
  # from each other via ECS Service Connect (modules/ecs-cluster namespace).
  ecs_services = {
    "customer-portal" = {
      port = 3000, health_path = "/api/health", public = true, path_patterns = ["/*"]
    }
    "exchange-service" = {
      port = 8080, health_path = "/health/live", public = false
    }
    "lakehouse-service" = {
      port = 8000, health_path = "/health/live", public = false
    }
    "catalog-service" = {
      port = 8092, health_path = "/health/live", public = false
    }
    "subscription-service" = {
      port = 8093, health_path = "/health/live", public = false
    }
    "scheduler-service" = {
      port = 8094, health_path = "/health/live", public = false
    }
    "publication-service" = {
      port = 8000, health_path = "/health/live", public = false
    }
    "product-api-service" = {
      port = 8095, health_path = "/health/live", public = true, path_patterns = ["/v1/*"]
    }
    "observability-service" = {
      port = 8097, health_path = "/health/live", public = false
    }
    "serving-projection-service" = {
      port = 8000, health_path = "/health/live", public = false
    }
  }

  default_container_image = "public.ecr.aws/docker/library/hello-world:latest"
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

module "networking" {
  source = "../../modules/networking"

  name_prefix               = local.name_prefix
  vpc_cidr                  = var.vpc_cidr
  availability_zones        = var.availability_zones
  public_subnet_cidrs       = var.public_subnet_cidrs
  private_app_subnet_cidrs  = var.private_app_subnet_cidrs
  private_data_subnet_cidrs = var.private_data_subnet_cidrs
  enable_nat_gateway        = var.enable_nat_gateway
  single_nat_gateway        = var.single_nat_gateway
  enable_vpc_endpoints      = true
  enable_flow_logs          = true
  kms_key_arn               = module.kms.primary_key_arn
  tags                      = local.common_tags
}

module "security" {
  source = "../../modules/security"

  name_prefix = local.name_prefix
  vpc_id      = module.networking.vpc_id
  tags        = local.common_tags
}

# ---------------------------------------------------------------------------
# Encryption, storage, secrets
# ---------------------------------------------------------------------------

module "kms" {
  source = "../../modules/kms"

  name_prefix = local.name_prefix
  tags        = local.common_tags
}

module "s3" {
  source = "../../modules/s3"

  name_prefix       = local.name_prefix
  bucket_suffix     = coalesce(var.aws_account_id, "changeme")
  kms_key_arn       = module.kms.primary_key_arn
  audit_kms_key_arn = module.kms.audit_key_arn

  buckets = {
    "exchange-inbound" = {
      versioning_enabled = true
      transition_ia_days = 90
    }
    "exchange-outbound" = {
      versioning_enabled = true
      transition_ia_days = 90
    }
    "lakehouse" = {
      versioning_enabled                 = true
      noncurrent_version_expiration_days = 365 # Iceberg snapshot metadata references old data files — do not expire aggressively; real cleanup is Iceberg snapshot-expiration maintenance (docs/aws/lakehouse.md §Iceberg maintenance), not blanket S3 lifecycle
      expiration_days                    = null
    }
    "audit" = {
      versioning_enabled    = true
      is_audit_bucket       = true
      enable_access_logging = false
      object_lock_enabled   = true
      expiration_days       = var.retention_days * 20 # long-lived by design; production tfvars sets this far higher
    }
  }

  tags = local.common_tags
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix = local.name_prefix
  kms_key_arn = module.kms.primary_key_arn

  secrets = {
    "portal/auth-secret"                = { description = "Auth.js AUTH_SECRET for the customer portal" }
    "portal/google-oauth-client-secret" = { description = "AUTH_GOOGLE_SECRET" }
    "portal/smtp-credentials"           = { description = "SMTP_USER/SMTP_PASS as JSON" }
    "identity/oidc-client-secret"       = { description = "OIDC client secret for the platform's identity provider" }
    "product-api/cursor-signing-secret" = { description = "CURSOR_SIGNING_SECRET" }
    "internal/service-api-keys"         = { description = "The *_INTERNAL_API_KEY family, one JSON key per caller pair" }
  }

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Databases
# ---------------------------------------------------------------------------

module "rds" {
  source   = "../../modules/rds"
  for_each = local.rds_services

  identifier        = "${local.name_prefix}-${each.key}"
  database_name     = each.value.db_name
  instance_class    = var.rds_instance_class
  allocated_storage = var.rds_allocated_storage

  subnet_ids             = module.networking.private_data_subnet_ids
  vpc_security_group_ids = [module.security.rds_security_group_id]
  kms_key_arn            = module.kms.primary_key_arn

  multi_az                = var.rds_multi_az
  deletion_protection     = var.rds_deletion_protection
  skip_final_snapshot     = var.rds_skip_final_snapshot
  backup_retention_period = var.rds_backup_retention_days

  tags = merge(local.common_tags, { Service = each.key })
}

# ---------------------------------------------------------------------------
# Lakehouse: Glue Data Catalog + optional EMR Serverless
# ---------------------------------------------------------------------------

module "glue" {
  source = "../../modules/glue"

  name_prefix           = local.name_prefix
  lakehouse_bucket_name = module.s3.bucket_names["lakehouse"]
  kms_key_arn           = module.kms.primary_key_arn
}

module "emr_serverless" {
  source = "../../modules/emr-serverless"
  count  = var.enable_emr ? 1 : 0

  name_prefix          = local.name_prefix
  subnet_ids           = module.networking.private_app_subnet_ids
  security_group_ids   = [module.security.ecs_internal_security_group_id]
  lakehouse_bucket_arn = module.s3.bucket_arns["lakehouse"]
  glue_database_arns = [
    "arn:aws:glue:${var.aws_region}:*:database/${module.glue.bronze_database_name}",
    "arn:aws:glue:${var.aws_region}:*:database/${module.glue.silver_database_name}",
    "arn:aws:glue:${var.aws_region}:*:database/${module.glue.gold_database_name}",
  ]
  kms_key_arn        = module.kms.primary_key_arn
  log_retention_days = var.retention_days

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Eventing
# ---------------------------------------------------------------------------

module "eventbridge" {
  source = "../../modules/eventbridge"

  name_prefix = local.name_prefix
  kms_key_arn = module.kms.primary_key_arn
  tags        = local.common_tags
}

module "sqs" {
  source = "../../modules/sqs"

  name_prefix = local.name_prefix
  kms_key_arn = module.kms.primary_key_arn

  queues = {
    "publication-requests"   = {}
    "delivery-notifications" = {}
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "publication_requested_to_sqs" {
  event_bus_name = module.eventbridge.event_bus_name
  rule           = module.eventbridge.rule_names["PublicationRequested"]
  arn            = module.sqs.queue_arns["publication-requests"]
}

resource "aws_cloudwatch_event_target" "delivery_ready_to_sqs" {
  event_bus_name = module.eventbridge.event_bus_name
  rule           = module.eventbridge.rule_names["DeliveryReady"]
  arn            = module.sqs.queue_arns["delivery-notifications"]
}

data "aws_iam_policy_document" "sqs_from_eventbridge" {
  for_each = {
    "publication-requests"   = module.eventbridge.rule_arns["PublicationRequested"]
    "delivery-notifications" = module.eventbridge.rule_arns["DeliveryReady"]
  }

  statement {
    sid    = "AllowEventBridgeSend"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    actions   = ["sqs:SendMessage"]
    resources = [module.sqs.queue_arns[each.key]]
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [each.value]
    }
  }
}

resource "aws_sqs_queue_policy" "from_eventbridge" {
  for_each = data.aws_iam_policy_document.sqs_from_eventbridge

  queue_url = module.sqs.queue_urls[each.key]
  policy    = each.value.json
}

# ---------------------------------------------------------------------------
# Container registry + compute cluster
# ---------------------------------------------------------------------------

module "ecr" {
  source = "../../modules/ecr"

  name_prefix  = local.name_prefix
  kms_key_arn  = module.kms.primary_key_arn
  repositories = keys(local.ecs_services)
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"

  name                      = "${local.name_prefix}-cluster"
  vpc_id                    = module.networking.vpc_id
  service_connect_namespace = "${local.name_prefix}.internal"
  kms_key_arn               = module.kms.primary_key_arn
  log_retention_days        = var.retention_days
  tags                      = local.common_tags
}

# ---------------------------------------------------------------------------
# IAM — one task role per workload (docs/aws/iam-permission-matrix.md)
# ---------------------------------------------------------------------------

locals {
  emr_job_statements = var.enable_emr ? [{
    sid       = "SubmitLakehouseJobs"
    actions   = ["emr-serverless:StartJobRun", "emr-serverless:GetJobRun", "emr-serverless:ListJobRuns", "emr-serverless:CancelJobRun"]
    resources = [module.emr_serverless[0].application_arn]
  }] : []

  glue_read_only_arns = [
    "arn:aws:glue:${var.aws_region}:*:catalog",
    "arn:aws:glue:${var.aws_region}:*:database/${module.glue.bronze_database_name}",
    "arn:aws:glue:${var.aws_region}:*:database/${module.glue.silver_database_name}",
    "arn:aws:glue:${var.aws_region}:*:database/${module.glue.gold_database_name}",
    "arn:aws:glue:${var.aws_region}:*:table/${module.glue.gold_database_name}/*",
  ]

  task_role_definitions = {
    "customer-portal" = {
      statements = []
    }

    "exchange-service" = {
      statements = [
        {
          sid     = "ExchangeBucketsReadWrite"
          actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
          resources = [
            module.s3.bucket_arns["exchange-inbound"], "${module.s3.bucket_arns["exchange-inbound"]}/*",
            module.s3.bucket_arns["exchange-outbound"], "${module.s3.bucket_arns["exchange-outbound"]}/*",
          ]
        },
        {
          sid       = "OwnDatabaseSecret"
          actions   = ["secretsmanager:GetSecretValue"]
          resources = [module.rds["exchange-service"].master_user_secret_arn]
        },
      ]
    }

    "lakehouse-service" = {
      statements = concat(
        [
          {
            sid       = "LakehouseBucketReadWrite"
            actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
            resources = [module.s3.bucket_arns["lakehouse"], "${module.s3.bucket_arns["lakehouse"]}/*"]
          },
          {
            sid       = "GlueCatalogReadWrite"
            actions   = ["glue:GetDatabase", "glue:GetDatabases", "glue:GetTable", "glue:GetTables", "glue:CreateTable", "glue:UpdateTable"]
            resources = local.glue_read_only_arns
          },
        ],
        local.emr_job_statements,
      )
    }

    "catalog-service" = {
      statements = [{
        sid       = "OwnDatabaseSecret"
        actions   = ["secretsmanager:GetSecretValue"]
        resources = [module.rds["catalog-service"].master_user_secret_arn]
      }]
    }

    "subscription-service" = {
      statements = [{
        sid       = "OwnDatabaseSecret"
        actions   = ["secretsmanager:GetSecretValue"]
        resources = [module.rds["subscription-service"].master_user_secret_arn]
      }]
    }

    "scheduler-service" = {
      statements = [
        {
          sid       = "OwnDatabaseSecret"
          actions   = ["secretsmanager:GetSecretValue"]
          resources = [module.rds["scheduler-service"].master_user_secret_arn]
        },
        {
          sid       = "PublishDomainEvents"
          actions   = ["events:PutEvents"]
          resources = [module.eventbridge.event_bus_arn]
        },
      ]
    }

    "publication-service" = {
      statements = [
        {
          sid       = "OwnDatabaseSecret"
          actions   = ["secretsmanager:GetSecretValue"]
          resources = [module.rds["publication-service"].master_user_secret_arn]
        },
        {
          sid       = "ReadGoldWriteOutbound"
          actions   = ["s3:GetObject", "s3:ListBucket"]
          resources = [module.s3.bucket_arns["lakehouse"], "${module.s3.bucket_arns["lakehouse"]}/gold/*"]
        },
        {
          sid       = "WriteOutboundArtifacts"
          actions   = ["s3:PutObject", "s3:ListBucket"]
          resources = [module.s3.bucket_arns["exchange-outbound"], "${module.s3.bucket_arns["exchange-outbound"]}/*"]
        },
        {
          sid       = "ReadGoldCatalog"
          actions   = ["glue:GetDatabase", "glue:GetTable", "glue:GetTables"]
          resources = local.glue_read_only_arns
        },
      ]
    }

    "product-api-service" = {
      statements = [{
        sid       = "ReadServingStoreSecret"
        actions   = ["secretsmanager:GetSecretValue"]
        resources = [module.rds["serving-projection-service"].master_user_secret_arn]
      }]
    }

    "observability-service" = {
      statements = [
        {
          sid       = "OwnDatabaseSecret"
          actions   = ["secretsmanager:GetSecretValue"]
          resources = [module.rds["observability-service"].master_user_secret_arn]
        },
        {
          sid       = "ReadLakehouseCatalogForHealthReporting"
          actions   = ["glue:GetDatabase", "glue:GetTable", "glue:GetTables"]
          resources = local.glue_read_only_arns
        },
      ]
    }

    "serving-projection-service" = {
      statements = [
        {
          sid       = "OwnDatabaseSecret"
          actions   = ["secretsmanager:GetSecretValue"]
          resources = [module.rds["serving-projection-service"].master_user_secret_arn]
        },
        {
          sid       = "ReadGold"
          actions   = ["s3:GetObject", "s3:ListBucket"]
          resources = [module.s3.bucket_arns["lakehouse"], "${module.s3.bucket_arns["lakehouse"]}/gold/*"]
        },
        {
          sid       = "ReadGoldCatalog"
          actions   = ["glue:GetDatabase", "glue:GetTable", "glue:GetTables"]
          resources = local.glue_read_only_arns
        },
      ]
    }
  }

  all_rds_secret_arns = [for k, v in module.rds : v.master_user_secret_arn]
}

module "iam" {
  source = "../../modules/iam"

  name_prefix = local.name_prefix
  task_roles  = local.task_role_definitions

  # The shared execution role (image pull + log shipping + secret injection
  # at task startup) can read every RDS-managed secret plus the
  # application-level secrets — this is standard AWS ECS plumbing, not an
  # application permission, so sharing it does not weaken least privilege
  # for the task roles above. See docs/aws/iam-permission-matrix.md.
  ecs_execution_secret_arns = concat(local.all_rds_secret_arns, values(module.secrets.secret_arns))
  kms_decrypt_key_arns      = [module.kms.primary_key_arn]

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Public entrypoint: ALB (+ optional CloudFront/WAF/Route 53 in front of it)
# ---------------------------------------------------------------------------

module "dns_regional" {
  source = "../../modules/route53"
  count  = var.enable_route53_records && !var.enable_cloudfront ? 1 : 0

  domain_name             = var.domain_name
  create_hosted_zone      = var.create_route53_hosted_zone
  hosted_zone_id          = var.route53_hosted_zone_id
  create_acm_certificate  = true
  create_alb_alias_record = false
  tags                    = local.common_tags
}

module "dns_cloudfront_cert" {
  source = "../../modules/route53"
  count  = var.enable_route53_records && var.enable_cloudfront ? 1 : 0
  providers = {
    aws = aws.us_east_1
  }

  domain_name             = var.domain_name
  create_hosted_zone      = var.create_route53_hosted_zone
  hosted_zone_id          = var.route53_hosted_zone_id
  create_acm_certificate  = true
  create_alb_alias_record = false
  tags                    = local.common_tags
}

locals {
  route53_zone_id = (
    var.enable_route53_records
    ? (var.enable_cloudfront ? module.dns_cloudfront_cert[0].zone_id : module.dns_regional[0].zone_id)
    : null
  )

  managed_certificate_arn = (
    var.enable_route53_records
    ? (var.enable_cloudfront ? module.dns_cloudfront_cert[0].certificate_arn : module.dns_regional[0].certificate_arn)
    : null
  )

  # See variables.tf: acm_certificate_arn_override lets an operator supply a
  # pre-existing certificate instead of having this stack manage Route 53.
  # One of the two must resolve to a real ARN before `apply` — this stack
  # always terminates TLS at the ALB.
  effective_certificate_arn = coalesce(var.acm_certificate_arn_override, local.managed_certificate_arn, "arn:aws:acm:REPLACE-ME")
}

module "alb" {
  source = "../../modules/alb"

  name_prefix        = local.name_prefix
  public_subnet_ids  = module.networking.public_subnet_ids
  security_group_ids = [module.security.alb_security_group_id]
  certificate_arn    = local.effective_certificate_arn
  access_logs_bucket = module.s3.bucket_names["audit"]

  enable_deletion_protection = var.environment == "production"

  tags = local.common_tags
}

resource "aws_route53_record" "public_alias" {
  count = var.enable_route53_records ? 1 : 0

  zone_id = local.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.enable_cloudfront ? module.cloudfront[0].domain_name : module.alb.alb_dns_name
    zone_id                = var.enable_cloudfront ? module.cloudfront[0].hosted_zone_id : module.alb.alb_zone_id
    evaluate_target_health = !var.enable_cloudfront
  }
}

module "waf_regional" {
  source = "../../modules/waf"
  count  = var.enable_waf && !var.enable_cloudfront ? 1 : 0

  name_prefix = local.name_prefix
  scope       = "REGIONAL"
  kms_key_arn = module.kms.primary_key_arn
  tags        = local.common_tags
}

resource "aws_wafv2_web_acl_association" "alb" {
  count = var.enable_waf && !var.enable_cloudfront ? 1 : 0

  resource_arn = module.alb.alb_arn
  web_acl_arn  = module.waf_regional[0].web_acl_arn
}

module "waf_cloudfront" {
  source = "../../modules/waf"
  count  = var.enable_waf && var.enable_cloudfront ? 1 : 0
  providers = {
    aws = aws.us_east_1
  }

  name_prefix = local.name_prefix
  scope       = "CLOUDFRONT"
  # No kms_key_arn here: modules/kms's key lives in var.aws_region, but this
  # module instance runs against the us-east-1 provider (a CloudFront WAF
  # WebACL requirement) — a CloudWatch log group can only use a KMS key in
  # its own region, so this log group is left SSE-managed rather than
  # provisioning a second, us-east-1-only KMS key just for it.
  tags = local.common_tags
}

module "cloudfront" {
  source = "../../modules/cloudfront"
  count  = var.enable_cloudfront ? 1 : 0

  name_prefix                = local.name_prefix
  alb_dns_name               = module.alb.alb_dns_name
  domain_aliases             = var.enable_route53_records ? [var.domain_name] : []
  certificate_arn            = var.enable_route53_records ? local.managed_certificate_arn : null
  web_acl_arn                = var.enable_waf ? module.waf_cloudfront[0].web_acl_arn : null
  logging_bucket_domain_name = module.s3.bucket_names["audit"] != null ? "${module.s3.bucket_names["audit"]}.s3.amazonaws.com" : null

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# Application services
# ---------------------------------------------------------------------------

module "ecs_service" {
  source   = "../../modules/ecs-service"
  for_each = local.ecs_services

  name_prefix       = local.name_prefix
  service_name      = each.key
  cluster_arn       = module.ecs_cluster.cluster_arn
  container_image   = lookup(var.container_images, each.key, local.default_container_image)
  container_port    = each.value.port
  health_check_path = each.value.health_path

  cpu           = var.ecs_cpu
  memory        = var.ecs_memory
  desired_count = each.value.public ? var.ecs_public_desired_count : var.ecs_internal_desired_count
  max_capacity  = var.ecs_max_capacity

  task_role_arn      = module.iam.task_role_arns[each.key]
  execution_role_arn = module.iam.ecs_execution_role_arn

  subnet_ids         = module.networking.private_app_subnet_ids
  security_group_ids = [each.value.public ? module.security.ecs_public_security_group_id : module.security.ecs_internal_security_group_id]

  vpc_id                     = each.value.public ? module.networking.vpc_id : null
  alb_listener_arn           = each.value.public ? module.alb.https_listener_arn : null
  alb_listener_rule_priority = each.value.public ? (each.key == "customer-portal" ? 100 : 90) : null
  alb_path_patterns          = each.value.public ? each.value.path_patterns : []

  service_connect_namespace_arn = module.ecs_cluster.service_connect_namespace_arn
  service_connect_dns_name      = each.key

  log_retention_days = var.retention_days
  kms_key_arn        = module.kms.primary_key_arn

  environment = merge(
    {
      NODE_ENV = "production"
      PORT     = tostring(each.value.port)
    },
    contains(keys(local.rds_services), each.key) ? {
      DATABASE_SECRET_ARN = module.rds[each.key].master_user_secret_arn
      # See docs/aws/database.md — the RDS-managed secret is JSON
      # (host/port/username/password/dbname), not a single connection
      # string. Composing DATABASE_URL from it is a small deployment-layer
      # step (an entrypoint wrapper reading this ARN via the AWS SDK before
      # exec'ing the existing app), not a business-logic change — tracked
      # in docs/aws/architecture-decisions.md.
    } : {},
  )

  secrets = contains(keys(local.rds_services), each.key) ? {
    PGHOST     = "${module.rds[each.key].master_user_secret_arn}:host::"
    PGPORT     = "${module.rds[each.key].master_user_secret_arn}:port::"
    PGUSER     = "${module.rds[each.key].master_user_secret_arn}:username::"
    PGPASSWORD = "${module.rds[each.key].master_user_secret_arn}:password::"
    PGDATABASE = "${module.rds[each.key].master_user_secret_arn}:dbname::"
  } : {}

  tags = merge(local.common_tags, { Service = each.key })

  depends_on = [module.iam]
}

# ---------------------------------------------------------------------------
# Observability + backup
# ---------------------------------------------------------------------------

module "observability" {
  source = "../../modules/observability"

  name_prefix       = local.name_prefix
  ecs_cluster_name  = module.ecs_cluster.cluster_name
  ecs_service_names = { for k, v in module.ecs_service : k => v.service_name }
  rds_identifiers   = { for k, v in module.rds : k => v.identifier }
  alb_arn_suffix    = null # populate once alarm_actions/SNS wiring is decided for this account — see docs/aws/observability.md

  tags = local.common_tags
}

module "backup" {
  source = "../../modules/backup"

  name_prefix       = local.name_prefix
  resource_arns     = [for k, v in module.rds : "arn:aws:rds:${var.aws_region}:${coalesce(var.aws_account_id, "*")}:db:${v.identifier}"]
  kms_key_arn       = module.kms.primary_key_arn
  enable_vault_lock = var.enable_vault_lock
  delete_after_days = var.rds_backup_retention_days * 5

  tags = local.common_tags
}
