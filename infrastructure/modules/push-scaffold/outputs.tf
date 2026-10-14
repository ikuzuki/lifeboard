output "function_name" {
  description = "Name of the dispatcher Lambda."
  value       = aws_lambda_function.push_dispatch.function_name
}

output "function_arn" {
  description = "ARN of the dispatcher Lambda."
  value       = aws_lambda_function.push_dispatch.arn
}

output "role_arn" {
  description = "ARN of the dispatcher's execution role."
  value       = aws_iam_role.push_dispatch.arn
}

output "log_group_name" {
  description = "Log group carrying the push_dispatch summary line for each window."
  value       = aws_cloudwatch_log_group.push_dispatch.name
}

output "vapid_private_key_parameter" {
  description = "SSM parameter to populate with the VAPID private key. Terraform creates it holding REPLACE_ME and never reads it back."
  value       = aws_ssm_parameter.vapid_private_key.name
}

output "vapid_public_key_parameter" {
  description = "SSM parameter to populate with the VAPID public key. The same value goes into the client build as VITE_VAPID_PUBLIC_KEY."
  value       = aws_ssm_parameter.vapid_public_key.name
}

output "schedule_names" {
  description = "Scheduler schedule per send window, keyed by slot."
  value       = { for slot, schedule in aws_scheduler_schedule.send : slot => schedule.name }
}
