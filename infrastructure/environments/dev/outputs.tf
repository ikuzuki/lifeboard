output "app_url" {
  description = "Where the app is served from: the custom domain if one is configured, otherwise the CloudFront address."
  value       = module.web_hosting.site_url
}

output "app_bucket_name" {
  description = "S3 bucket to sync the Vite build output (dist/) to."
  value       = module.web_hosting.app_bucket_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID, for the invalidation that follows a deploy."
  value       = module.web_hosting.cloudfront_distribution_id
}

output "user_pool_id" {
  description = "Cognito user pool ID."
  value       = local.user_pool_id
}

output "user_pool_client_id" {
  description = "Cognito app client ID."
  value       = local.user_pool_client_id
}

output "identity_pool_id" {
  description = "Cognito identity pool ID."
  value       = local.identity_pool_id
}

output "hosted_ui_domain" {
  description = "Cognito hosted UI domain."
  value       = local.hosted_ui_domain
}

output "hosted_ui_login_url" {
  description = "Hosted UI login URL, for checking the Google flow end to end before the app wires it up."
  value       = one(module.auth[*].hosted_ui_login_url)
}

output "google_redirect_uri" {
  description = "Register this exact string as an Authorised redirect URI on the Google OAuth client, or sign-in fails with redirect_uri_mismatch."
  value       = one(module.auth[*].google_redirect_uri)
}

output "google_javascript_origin" {
  description = "Register this as an Authorised JavaScript origin on the Google OAuth client."
  value       = one(module.auth[*].google_javascript_origin)
}

output "user_data_bucket_name" {
  description = "S3 bucket holding per-user state documents."
  value       = local.user_data_bucket
}

output "authenticated_role_arn" {
  description = "IAM role authenticated users assume through the identity pool."
  value       = one(module.user_data[*].authenticated_role_arn)
}

# One block to paste into the frontend's runtime config. Nothing here is a
# secret: the client IDs are public identifiers and the credentials the app
# uses are minted per session by the identity pool.
output "frontend_config" {
  description = "Every value the client needs, collected in one object."
  value = {
    region              = "eu-west-2"
    userPoolId          = local.user_pool_id
    userPoolClientId    = local.user_pool_client_id
    identityPoolId      = local.identity_pool_id
    hostedUiDomain      = local.hosted_ui_domain
    userDataBucket      = local.user_data_bucket
    userDataKeyTemplate = one(module.user_data[*].key_template)
    appUrl              = module.web_hosting.site_url
  }
}
