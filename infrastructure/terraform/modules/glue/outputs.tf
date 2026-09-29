output "bronze_database_name" {
  value = aws_glue_catalog_database.bronze.name
}

output "silver_database_name" {
  value = aws_glue_catalog_database.silver.name
}

output "gold_database_name" {
  value = aws_glue_catalog_database.gold.name
}
