# AWS Glue Data Catalog here is the PHYSICAL lakehouse metadata store (table
# schemas, partitions, Iceberg table pointers) — it is a distinct system from
# the Data Product Catalog Service (Phase 5), which is the BUSINESS/product
# metadata store (contracts, SLAs, versions). Do not conflate the two: an
# entry existing in one implies nothing about the other. See
# docs/aws/lakehouse.md.
#
# This replaces data-lakehouse's local PyIceberg `SqlCatalog` (Postgres-
# backed) with the Glue Catalog, per that service's own code comment that
# this swap is "a configuration change ... only." Bronze/Silver/Gold stay as
# three separate Iceberg namespaces (Glue databases) in one physical bucket,
# mirroring how the local MinIO layout already separates them by prefix.

resource "aws_glue_catalog_database" "bronze" {
  name         = "${replace(var.name_prefix, "-", "_")}_bronze"
  description  = "Iceberg tables — raw ingested data, as delivered by data-exchange-service"
  location_uri = "s3://${var.lakehouse_bucket_name}/bronze/"

  tags = var.tags
}

resource "aws_glue_catalog_database" "silver" {
  name         = "${replace(var.name_prefix, "-", "_")}_silver"
  description  = "Iceberg tables — cleaned/conformed data"
  location_uri = "s3://${var.lakehouse_bucket_name}/silver/"

  tags = var.tags
}

resource "aws_glue_catalog_database" "gold" {
  name         = "${replace(var.name_prefix, "-", "_")}_gold"
  description  = "Iceberg tables — curated Data Product outputs, read by data-publication-service and serving-projection-service"
  location_uri = "s3://${var.lakehouse_bucket_name}/gold/"

  tags = var.tags
}

# Glue Data Catalog encryption is an account/region-level setting, not a
# per-database resource — this is the one place that KMS key actually gets
# wired to Glue.
resource "aws_glue_data_catalog_encryption_settings" "this" {
  data_catalog_encryption_settings {
    encryption_at_rest {
      catalog_encryption_mode = "SSE-KMS"
      sse_aws_kms_key_id      = var.kms_key_arn
    }

    connection_password_encryption {
      return_connection_password_encrypted = true
      aws_kms_key_id                       = var.kms_key_arn
    }
  }
}
