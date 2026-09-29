variable "name_prefix" {
  type = string
}

variable "lakehouse_bucket_name" {
  description = "The S3 bucket holding Bronze/Silver/Gold Iceberg table data (modules/s3 \"lakehouse\" bucket)."
  type        = string
}

variable "kms_key_arn" {
  description = "Encrypts the Glue Data Catalog metadata at rest."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
