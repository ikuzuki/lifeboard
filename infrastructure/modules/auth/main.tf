data "aws_region" "current" {}

locals {
  supported_identity_providers = concat(
    [aws_cognito_identity_provider.google.provider_name],
    var.allow_cognito_native_signin ? ["COGNITO"] : [],
  )
}

# -----------------------------------------------------------------------------
# User pool
#
# Email is the linking attribute. username_attributes = ["email"] makes the
# email address the sign-in identifier for native accounts, and the Google
# attribute mapping below writes Google's verified email onto the federated
# user, so both routes land on the same address.
#
# What this does NOT do is merge a native account and a Google account that
# share an address into one identity: Cognito only does that if a pre-sign-up
# Lambda trigger calls AdminLinkProviderForUser. With native sign-in off (the
# default) there is nothing to merge, which is why no trigger is built here.
# -----------------------------------------------------------------------------
resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.environment}"

  # Refuses any address not on the allowlist. Federated sign-in never reaches the pool
  # without passing this first.
  lambda_config {
    pre_sign_up = aws_lambda_function.presignup.arn
  }

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 2048
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_self_signup
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }
}

# -----------------------------------------------------------------------------
# Hosted UI domain
#
# The prefix is globally unique across every AWS account, so a clash surfaces
# at apply time as an InvalidParameterException rather than anything subtler.
# -----------------------------------------------------------------------------
resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.user_pool_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

# -----------------------------------------------------------------------------
# Google federated identity provider
#
# client_id and client_secret come from a Google Cloud OAuth 2.0 Web
# application credential and are marked sensitive throughout. They are not
# read from state by the app: the browser only ever sees the user pool client
# ID, which is public by design.
#
# The Google redirect URI that must be registered on the Google side is
# https://{domain_prefix}.auth.{region}.amazoncognito.com/oauth2/idpresponse
# and is emitted as the google_redirect_uri output.
# -----------------------------------------------------------------------------
resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    # Every plan shows this block removing attributes_url, authorize_url, oidc_issuer,
    # token_url and token_request_method. Cognito fills those in itself for a Google
    # provider and puts them in state, where Terraform sees values it has no config for.
    # Applying does not break the provider: the values come straight back. Pinning them
    # here would silence the diff at the cost of hardcoding Google's endpoints, and
    # ignore_changes cannot be scoped to part of the map without also freezing the
    # client id and secret, which have to stay changeable.
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = var.google_authorize_scopes
  }

  # username = sub is mandatory for Google. email is what makes the pool's
  # linking attribute meaningful; email_verified stops Cognito treating a
  # Google-verified address as unverified.
  attribute_mapping = {
    username       = "sub"
    email          = "email"
    email_verified = "email_verified"
    given_name     = "given_name"
    family_name    = "family_name"
  }
}

# -----------------------------------------------------------------------------
# App client
#
# Public SPA client: no secret, authorisation code flow with PKCE (the SDK
# handles the challenge). Implicit flow is deliberately not enabled.
# -----------------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project}-${var.environment}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = var.oauth_scopes
  supported_identity_providers         = local.supported_identity_providers

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  access_token_validity  = var.access_token_validity_minutes
  id_token_validity      = var.access_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  read_attributes  = ["email", "email_verified", "given_name", "family_name"]
  write_attributes = ["email", "given_name", "family_name"]
}

# -----------------------------------------------------------------------------
# Identity pool
#
# Trades the user pool ID token for temporary, per-identity AWS credentials.
# The identity ID it mints is the value the data-store IAM policy interpolates
# as cognito-identity.amazonaws.com:sub, so this resource is what makes the
# per-user S3 prefix isolation possible.
#
# Unauthenticated identities are off: there is no anonymous mode, and leaving
# them on would hand out credentials to anyone who asked.
# server_side_token_check makes Cognito verify the user still exists in the
# pool on every credential request, so deleting a user revokes access rather
# than waiting for the refresh token to lapse.
# -----------------------------------------------------------------------------
resource "aws_cognito_identity_pool" "main" {
  identity_pool_name               = "${var.project} ${var.environment}"
  allow_unauthenticated_identities = false
  allow_classic_flow               = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.web.id
    provider_name           = aws_cognito_user_pool.main.endpoint
    server_side_token_check = true
  }
}
