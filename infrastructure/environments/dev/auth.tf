locals {
  app_origins = [module.web_hosting.site_url, var.dev_server_origin]

  # Auth and everything keyed to an identity are optional together, so the rest of this
  # root reads these rather than reaching into a counted module. Null when auth is off.
  user_pool_id        = one(module.auth[*].user_pool_id)
  user_pool_client_id = one(module.auth[*].user_pool_client_id)
  identity_pool_id    = one(module.auth[*].identity_pool_id)
  hosted_ui_domain    = one(module.auth[*].hosted_ui_domain)
  user_data_bucket    = one(module.user_data[*].bucket_name)

  # Cognito matches redirect_uri exactly, and libraries differ on whether they
  # append a trailing slash to the origin. Both forms are registered so the
  # choice sits with the client rather than requiring a Terraform change.
  oauth_redirect_urls = distinct(flatten([
    for origin in local.app_origins : [origin, "${origin}/"]
  ]))
}

# -----------------------------------------------------------------------------
# Google OAuth credentials
#
# Read from Parameter Store rather than taken as variables. They are needed at
# apply time by the Cognito identity provider, so they have to live somewhere both
# a laptop and CI can reach, and Parameter Store is already this stack's secret
# store for the Anthropic key and the sign-in allowlist. It also means the values
# can be read back, which a GitHub Actions secret cannot.
#
# Create them once, before the first plan:
#   MSYS_NO_PATHCONV=1 aws ssm put-parameter --type String #     --name /lifeboard/dev/google-client-id --value '<id>'
#   MSYS_NO_PATHCONV=1 aws ssm put-parameter --type SecureString #     --name /lifeboard/dev/google-client-secret --value '<secret>'
# -----------------------------------------------------------------------------
data "aws_ssm_parameter" "google_client_id" {
  count = var.enable_auth ? 1 : 0
  name  = "${var.secret_prefix}/${var.environment}/google-client-id"
}

data "aws_ssm_parameter" "google_client_secret" {
  count = var.enable_auth ? 1 : 0
  name  = "${var.secret_prefix}/${var.environment}/google-client-secret"
}

# -----------------------------------------------------------------------------
# Auth: Cognito user pool federated to Google, plus the identity pool that
# turns the resulting ID token into temporary AWS credentials.
# -----------------------------------------------------------------------------
module "auth" {
  count  = var.enable_auth ? 1 : 0
  source = "../../modules/auth"

  environment             = var.environment
  user_pool_domain_prefix = var.user_pool_domain_prefix

  google_client_id     = one(data.aws_ssm_parameter.google_client_id[*].value)
  google_client_secret = one(data.aws_ssm_parameter.google_client_secret[*].value)

  callback_urls = local.oauth_redirect_urls
  logout_urls   = local.oauth_redirect_urls

  initial_allowlist = var.initial_allowlist
}

# -----------------------------------------------------------------------------
# Identity pool role attachment
#
# Lives here rather than in either module because it is the join between them:
# the auth module owns the identity pool, the user-data module owns the role,
# and neither should depend on the other's outputs.
#
# Only the authenticated role is set. Unauthenticated identities are disabled
# on the pool, so there is no unauthenticated role to attach.
# -----------------------------------------------------------------------------
resource "aws_cognito_identity_pool_roles_attachment" "main" {
  count            = var.enable_auth ? 1 : 0
  identity_pool_id = local.identity_pool_id

  roles = {
    authenticated = one(module.user_data[*].authenticated_role_arn)
  }
}
