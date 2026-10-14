output "user_pool_id" {
  description = "Cognito user pool ID. Frontend configuration value."
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN."
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_client_id" {
  description = "Public app client ID. Safe to ship in the built bundle: it is an identifier, not a credential."
  value       = aws_cognito_user_pool_client.web.id
}

output "identity_pool_id" {
  description = "Cognito identity pool ID. Consumed by the user-data module to scope the authenticated role's trust policy."
  value       = aws_cognito_identity_pool.main.id
}

output "hosted_ui_domain" {
  description = "Fully qualified hosted UI domain, e.g. lifeboard-dev.auth.eu-west-2.amazoncognito.com."
  value       = "${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "hosted_ui_login_url" {
  description = "Ready-made hosted UI login URL for the first callback URL. Useful for checking the Google flow before the app wires it up."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com/login?client_id=${aws_cognito_user_pool_client.web.id}&response_type=code&scope=${join("+", var.oauth_scopes)}&redirect_uri=${urlencode(var.callback_urls[0])}"
}

output "google_redirect_uri" {
  description = "Value to register as an Authorised redirect URI on the Google OAuth client. Google rejects the sign-in with redirect_uri_mismatch until this exact string is present."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com/oauth2/idpresponse"
}

output "google_javascript_origin" {
  description = "Value to register as an Authorised JavaScript origin on the Google OAuth client."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}
