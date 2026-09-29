# AWS Architecture

Status: **NOT DEPLOYED.** This describes what `infrastructure/terraform/` is capable of producing,
not anything that currently exists in an AWS account.

## Logical architecture

```mermaid
flowchart TB
    internet((Internet))
    r53[Route 53]
    cf[CloudFront]
    waf[AWS WAF]
    alb[Application Load Balancer]

    internet --> r53 --> cf --> waf --> alb

    subgraph ecs["ECS Fargate (modules/ecs-cluster, modules/ecs-service)"]
        portal[customer-portal]
        productapi[product-api-service]
        exchange[exchange-service]
        lakehousesvc[lakehouse-service]
        catalog[catalog-service]
        subscription[subscription-service]
        scheduler[scheduler-service]
        publication[publication-service]
        observability[observability-service]
        servingproj[serving-projection-service]
    end

    alb --> portal
    alb --> productapi

    portal -. Service Connect .-> exchange
    portal -. Service Connect .-> lakehousesvc
    portal -. Service Connect .-> catalog
    portal -. Service Connect .-> publication
    portal -. Service Connect .-> subscription
    portal -. Service Connect .-> scheduler
    portal -. Service Connect .-> observability

    exchange --> s3in[S3 exchange-inbound]
    exchange --> s3out[S3 exchange-outbound]
    exchange -->|pipeline_jobs poll loop| lakehousesvc
    exchange -->|pipeline_jobs poll loop| publication

    lakehousesvc -->|submit job| emr[EMR Serverless]
    emr --> s3lake[S3 lakehouse: bronze/silver/gold]
    emr --> glue[Glue Data Catalog]

    publication --> s3lake
    publication --> s3out
    servingproj --> s3lake
    servingproj --> servingdb[(RDS: serving store)]
    productapi --> servingdb

    exchange --> exchangedb[(RDS: exchange)]
    catalog --> catalogdb[(RDS: catalog)]
    subscription --> subdb[(RDS: subscription)]
    scheduler --> schedulerdb[(RDS: scheduler)]
    publication --> pubdb[(RDS: publication)]
    observability --> obsdb[(RDS: observability)]

    scheduler -->|events:PutEvents| eb[EventBridge bus]
    eb --> sqs1[SQS: publication-requests]
    eb --> sqs2[SQS: delivery-notifications]

    observability -.->|poll HTTP APIs| exchange
    observability -.->|poll HTTP APIs| scheduler
    observability -.->|poll HTTP APIs| publication
    observability -.->|poll HTTP APIs| servingproj
```

MongoDB (portal user/org/tenant directory) is intentionally absent from this diagram — see
`docs/aws/architecture-decisions.md` #3. It is not deployed by this Terraform package.

## Physical / account-boundary view

```mermaid
flowchart LR
    subgraph pub["Public subnets (per AZ)"]
        albres[ALB ENIs]
        nat[NAT Gateway]
    end
    subgraph appsub["Private APPLICATION subnets (per AZ)"]
        ecstasks[ECS Fargate tasks\n- portal, product-api\n- exchange, lakehouse, catalog,\n  subscription, scheduler,\n  publication, observability,\n  serving-projection]
        vpce[Interface VPC Endpoints\nECR / Secrets Manager / Logs]
    end
    subgraph datasub["Private DATA subnets (per AZ) — NO internet route"]
        rds[(7x RDS PostgreSQL)]
    end

    igw[Internet Gateway] --- pub
    pub --> appsub
    appsub --> datasub
    appsub -->|S3 Gateway Endpoint| s3[(S3 buckets)]
    ecstasks --> vpce
```

Every RDS instance sits in a subnet tier with no route to the internet at all (see
`modules/networking`) — this makes "public RDS" a structural impossibility, not a checkbox. See
`docs/aws/networking.md`.

## Terraform / module architecture

```mermaid
flowchart TB
    subgraph bootstrap["infrastructure/terraform/bootstrap (local state, run once per account)"]
        b1[S3 state bucket + KMS key]
    end

    subgraph envs["infrastructure/terraform/environments/{dev,staging,production}"]
        e1[main.tf — near-identical across all three]
    end

    subgraph modules["infrastructure/terraform/modules (20 reusable modules)"]
        m1[networking]
        m2[security]
        m3[kms]
        m4[s3]
        m5[secrets]
        m6[rds]
        m7[iam]
        m8[ecr]
        m9["ecs-cluster / ecs-service"]
        m10[alb]
        m11["cloudfront / waf / route53"]
        m12[glue]
        m13["emr-serverless"]
        m14["eventbridge / sqs"]
        m15[observability]
        m16[backup]
    end

    e1 -->|backend "s3" {} configured via backend.<env>.hcl| b1
    e1 --> modules
```

## Account / environment strategy

```mermaid
flowchart LR
    dev[dev account\nor dev/* prefix\nin a shared account] -->|promote image tag| staging[staging account]
    staging -->|promote image tag| production[production account\nrecommended: dedicated]
```

See `docs/aws/account-strategy.md` for the reasoning and trade-offs, and
`docs/aws/gcp-portability.md` for how each AWS choice above maps to GCP if ever needed.
