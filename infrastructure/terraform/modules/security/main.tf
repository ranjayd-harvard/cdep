# Security boundary chain enforced here:
#
#   internet -> ALB SG -> ECS public-app SG -----\
#                                                  +--> RDS SG
#                         ECS internal-service SG-/
#
# ECS public-app services (customer portal, product API) are the only ones
# reachable from the ALB. Internal services (exchange, catalog, subscription,
# scheduler, publication, observability) are only reachable from other ECS
# tasks, never from the ALB directly. Nothing but ECS reaches RDS, and RDS
# never gets an egress rule since it never initiates outbound connections.

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Public entrypoint: internet (or CloudFront/WAF) to the ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP (redirected to HTTPS by listener rule)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.alb_ingress_cidrs
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.alb_ingress_cidrs
  }

  egress {
    description = "All outbound - see docs/aws/security.md for why this SGs egress is not further restricted"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-sg" })
}

resource "aws_security_group" "ecs_public" {
  name        = "${var.name_prefix}-ecs-public-sg"
  description = "ECS services fronted by the ALB (customer portal, product API)"
  vpc_id      = var.vpc_id

  egress {
    description = "All outbound - see docs/aws/security.md for why this SGs egress is not further restricted"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-ecs-public-sg" })
}

resource "aws_security_group_rule" "ecs_public_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs_public.id
  from_port                = var.container_port_range.from
  to_port                  = var.container_port_range.to
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  description              = "ALB to ECS public app container port"
}

resource "aws_security_group" "ecs_internal" {
  name        = "${var.name_prefix}-ecs-internal-sg"
  description = "Internal-only ECS services (exchange, catalog, subscription, scheduler, publication, observability)"
  vpc_id      = var.vpc_id

  egress {
    description = "All outbound - see docs/aws/security.md for why this SGs egress is not further restricted"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-ecs-internal-sg" })
}

resource "aws_security_group_rule" "ecs_internal_from_public" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs_internal.id
  from_port                = var.container_port_range.from
  to_port                  = var.container_port_range.to
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_public.id
  description              = "Public ECS services calling internal services"
}

resource "aws_security_group_rule" "ecs_internal_from_internal" {
  type                     = "ingress"
  security_group_id        = aws_security_group.ecs_internal.id
  from_port                = var.container_port_range.from
  to_port                  = var.container_port_range.to
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_internal.id
  description              = "Service-to-service calls between internal ECS services"
}

resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "PostgreSQL access - ECS task security groups only, never the internet"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-rds-sg" })
}

resource "aws_security_group_rule" "rds_from_ecs_public" {
  type                     = "ingress"
  security_group_id        = aws_security_group.rds.id
  from_port                = var.database_port
  to_port                  = var.database_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_public.id
  description              = "Public-facing ECS services (e.g. product API) reading their database"
}

resource "aws_security_group_rule" "rds_from_ecs_internal" {
  type                     = "ingress"
  security_group_id        = aws_security_group.rds.id
  from_port                = var.database_port
  to_port                  = var.database_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_internal.id
  description              = "Internal ECS services reading/writing their database"
}
