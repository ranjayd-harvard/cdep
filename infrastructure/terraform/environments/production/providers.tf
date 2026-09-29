provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project     = var.project_name
        Environment = var.environment
        ManagedBy   = "Terraform"
      },
      var.tags,
    )
  }
}

# CloudFront + any WAF WebACL of scope CLOUDFRONT + ACM certificates that
# feed CloudFront must be created against us-east-1 regardless of
# aws_region — this is an AWS API requirement, not a choice this repository
# makes. See docs/aws/networking.md.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = merge(
      {
        Project     = var.project_name
        Environment = var.environment
        ManagedBy   = "Terraform"
      },
      var.tags,
    )
  }
}
