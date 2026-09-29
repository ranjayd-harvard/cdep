terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Deployment-time backend configuration only — see backend.tf and
  # backend.dev.hcl.example. No bucket/region/key is hard-coded here.
  backend "s3" {}
}
