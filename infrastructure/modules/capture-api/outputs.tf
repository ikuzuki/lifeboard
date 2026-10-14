output "endpoint" {
  description = "Base URL for the capture API. Goes into VITE_CAPTURE_ENDPOINT; the client posts to {endpoint}/capture."
  value       = aws_apigatewayv2_api.capture.api_endpoint
}

output "function_name" {
  description = "Lambda function name, for reading logs."
  value       = aws_lambda_function.capture.function_name
}

output "api_key_parameter_name" {
  description = "SSM parameter to populate with the real Anthropic API key after the first apply. Terraform creates it holding a placeholder and never reads it back."
  value       = aws_ssm_parameter.anthropic_api_key.name
}

output "log_group_name" {
  description = "Lambda log group. Token usage is logged here as capture_usage key=value lines."
  value       = aws_cloudwatch_log_group.capture.name
}
