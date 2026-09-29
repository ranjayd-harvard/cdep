# Cost Model

No AWS resource has been created, so these are estimation drivers and cost-saving levers, not a
bill. Actual pricing varies by region/date — check the AWS Pricing Calculator before committing to
a budget.

## Primary cost drivers, roughly ordered by typical impact

1. **NAT Gateway(s)** — hourly charge + per-GB data processing. `single_nat_gateway = true` (dev/
   staging default) uses one; production's `single_nat_gateway = false` uses one per AZ (2–3x the
   hourly cost, but removes a single point of failure). VPC endpoints (`enable_vpc_endpoints`, on
   by default) reduce the *data volume* through NAT for S3/ECR/Secrets Manager/Logs traffic, but
   don't eliminate the gateway's own hourly charge.
2. **RDS instances** — 7 instances x instance class x Multi-AZ multiplier (2x compute when
   `rds_multi_az = true`, production only) x storage. This is usually the largest fixed cost once
   NAT is optimized, precisely because there are seven of them (one per owning service) rather than
   a shared cluster — see `docs/aws/architecture-decisions.md` #1 for why, and reconsider
   consolidation later if cost pressure warrants it.
3. **ECS Fargate** — ten services x `desired_count` x (`cpu`,`memory`) x hours running. Fargate has
   no idle-cluster cost (unlike EC2-backed ECS) but every running task is billed continuously,
   unlike Lambda.
4. **EMR Serverless** (`enable_emr`, off by default in dev) — billed per vCPU-second/GB-second only
   while a job is actually running (`auto_stop_configuration`, 15-minute idle timeout) — cheap when
   idle, real cost only when jobs run.
5. **CloudFront + WAF** (`enable_cloudfront`/`enable_waf`, off by default in dev) — CloudFront:
   per-GB transfer + request count; WAF: per-WebACL + per-rule + per-million-requests. Both are
   flat-rate-ish and small compared to NAT/RDS/ECS at low-to-moderate traffic.
6. **S3 storage + requests** — usually small relative to compute/database costs unless the
   lakehouse bucket grows large; the lakehouse bucket's lifecycle deliberately never blanket-expires
   (`docs/aws/storage.md`), so storage cost there grows with retained Iceberg history until Iceberg
   maintenance jobs prune it.
7. **CloudWatch Logs** — ten services' log groups + EMR's, ingestion + storage, bounded by
   `retention_days` (14/30/90 across dev/staging/production) — a real, easy-to-overlook cost if
   retention is set very long or log volume is high.
8. **AWS Backup** — additional snapshot storage beyond RDS's own automated backups (a second,
   independently-retained copy — see `docs/aws/backup-recovery.md`).

## Cost-conscious variables (Phase 12 §50 — already wired)

| Lever | Variable | Dev default | Production default |
|---|---|---|---|
| NAT topology | `single_nat_gateway` | `true` (1 gateway) | `false` (1 per AZ) |
| RDS size | `rds_instance_class` | `db.t4g.micro` | `db.r6g.large` |
| RDS Multi-AZ | `rds_multi_az` | `false` | `true` |
| ECS task count | `ecs_public_desired_count`/`ecs_internal_desired_count` | 1/1 | 3/2 |
| ECS sizing | `ecs_cpu`/`ecs_memory` | 256/512 | 1024/2048 |
| CloudFront | `enable_cloudfront` | `false` | `true` |
| WAF | `enable_waf` | `false` | `true` |
| EMR Serverless | `enable_emr` | `false` | `true` |
| Log retention | `retention_days` | 14 | 90 |
| Backup retention | `rds_backup_retention_days` | 3 | 30 |

## Not modeled

- Data transfer between AZs (ECS ↔ RDS cross-AZ traffic when Multi-AZ is enabled) — usually small
  relative to internet egress but non-zero.
- Container image storage in ECR (`untagged_image_expiry_days`/`max_tagged_images_to_keep` in
  `modules/ecr` bound this, but the exact GB depends on image size).
- Actual traffic volume — every driver above scales with real usage this Terraform package has no
  way to predict before a real deployment exists.
