output "bucket_name" {
  description = "Name of the per-user state bucket. Frontend configuration value."
  value       = aws_s3_bucket.user_data.id
}

output "bucket_arn" {
  description = "ARN of the per-user state bucket."
  value       = aws_s3_bucket.user_data.arn
}

output "authenticated_role_arn" {
  description = "ARN of the role authenticated users assume. Wire this into the identity pool's roles attachment."
  value       = aws_iam_role.authenticated.arn
}

output "authenticated_role_name" {
  description = "Name of the role authenticated users assume."
  value       = aws_iam_role.authenticated.name
}

output "key_template" {
  description = "Shape of the key each client writes. The identity ID is whatever GetId returns for the signed-in user, so the client must not derive it from the email or the user pool sub."
  value       = "users/{cognito-identity-id}/state.json"
}
