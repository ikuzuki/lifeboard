output "state_bucket_name" {
  description = "S3 bucket holding Terraform state. Referenced by the backend block in each environment root."
  value       = aws_s3_bucket.tf_state.id
}

output "lock_table_name" {
  description = "DynamoDB table used for Terraform state locking."
  value       = aws_dynamodb_table.tf_lock.name
}

output "cicd_role_arn" {
  description = "ARN of the GitHub Actions deploy role, or null when enable_github_oidc is false."
  value       = var.enable_github_oidc ? aws_iam_role.cicd[0].arn : null
}
