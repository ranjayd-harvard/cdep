# Account Strategy

## Recommendation: separate AWS accounts per environment

`infrastructure/terraform/` supports both models without code changes — every module takes account
identity as an input (via the provider's own credentials + tagging variables), nothing hard-codes
one account ID. The choice is made at deploy time by which credentials/backend config you point
`terraform init`/`apply` at for each environment.

**Prefer separate accounts** (dev, staging, production each their own AWS account, e.g. under AWS
Organizations) because:

- Blast radius: an IAM mistake, a runaway cost, or a compromised credential in dev cannot reach
  production resources — there is no shared account boundary to cross.
- IAM is simpler: no need to scope every policy with `Condition: aws:ResourceTag/Environment` to
  prevent a dev role from touching a production resource: it structurally cannot.
- Billing is naturally separated per environment with no tag-based cost allocation required.
- This matches the phase's own bootstrap design: each environment gets its own Terraform state
  bucket (`infrastructure/terraform/bootstrap` run once per account), which is most natural when
  state buckets are already segregated by account.

**Acceptable fallback: one account, environment-prefixed resources.** If organizational constraints
mean dev/staging/production must share one account, every resource this Terraform creates is
already named `{project}-{environment}-...`, and every environment gets its own VPC (non-overlapping
CIDRs — see `terraform.tfvars.example` per environment), so nothing collides. The state bucket can
either be one bucket with per-environment `key` prefixes (`backend.<env>.hcl`'s `key` already does
this) or one bucket per environment — both work with the bootstrap stack as written.

## What doesn't change either way

- `infrastructure/terraform/bootstrap` is run once **per state bucket**, i.e. once per account in
  the separate-accounts model, or once total (with per-environment keys) in the shared-account
  model.
- Each environment's `environments/<env>/backend.<env>.hcl` always points `bucket`/`key`/`region` at
  wherever that environment's state actually lives — nothing here assumes a specific layout.
- IAM roles created by `modules/iam` are always scoped to the resources Terraform creates in that
  same apply — cross-account references are never assumed.

## Production, specifically

Given the choice, put production in its own account even if dev/staging share one. Production's
`terraform.tfvars.example` assumes `create_route53_hosted_zone = true` (i.e., production owns the
root public hosted zone) precisely because a dedicated account is the expected shape; if production
shares an account with something else, adjust that value and `route53_hosted_zone_id` accordingly.
