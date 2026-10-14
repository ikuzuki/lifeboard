variable "project" {
  description = "Project name for resource naming"
  type        = string
  default     = "lifeboard"
}

variable "environment" {
  description = "Deployment environment (dev/prod)"
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be dev or prod."
  }
}

variable "user_pool_domain_prefix" {
  description = "Prefix for the Cognito hosted UI domain, giving https://{prefix}.auth.{region}.amazoncognito.com. Globally unique across all AWS accounts, lowercase letters, digits and hyphens only, so pick something account-specific."
  type        = string
}

variable "google_client_id" {
  description = "OAuth 2.0 client ID from the Google Cloud console (APIs & Services, Credentials, Web application). See infrastructure/README.md for the exact steps. Never commit the value: pass it via TF_VAR_google_client_id or a gitignored tfvars file."
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "OAuth 2.0 client secret paired with google_client_id. Never commit the value: pass it via TF_VAR_google_client_secret or a gitignored tfvars file."
  type        = string
  sensitive   = true
}

variable "callback_urls" {
  description = "URLs Cognito may redirect to after a successful sign-in. Include the deployed origin and http://localhost:5173 so the dev server can complete the flow against the same user pool."
  type        = list(string)
}

variable "logout_urls" {
  description = "URLs Cognito may redirect to after sign-out. Usually the same set as callback_urls."
  type        = list(string)
}

variable "oauth_scopes" {
  description = "OAuth scopes the app client may request. openid yields the ID token the identity pool exchanges for AWS credentials; email is the linking attribute; profile supplies a display name."
  type        = list(string)
  default     = ["openid", "email", "profile"]
}

variable "google_authorize_scopes" {
  description = "Scopes Cognito requests from Google. Must include email for attribute mapping to populate the linking attribute."
  type        = string
  default     = "openid email profile"
}

variable "allow_cognito_native_signin" {
  description = "Also offer username and password sign-in on the hosted UI alongside Google. False keeps Google as the only route in, which is the intended single-user setup."
  type        = bool
  default     = false
}

variable "allow_self_signup" {
  description = "Allow anyone to self-register through the SignUp API. False sets allow_admin_create_user_only, so native accounts must be created by an administrator. It does not by itself restrict which Google accounts may federate: see the pre-sign-up note in infrastructure/README.md."
  type        = bool
  default     = false
}

variable "access_token_validity_minutes" {
  description = "Lifetime of the access and ID tokens, in minutes."
  type        = number
  default     = 60
}

variable "refresh_token_validity_days" {
  description = "Lifetime of the refresh token, in days. Sets how long a returning user stays signed in without another Google round trip."
  type        = number
  default     = 30
}

variable "secret_prefix" {
  description = "SSM path prefix for this project's parameters."
  type        = string
  default     = "/lifeboard"
}

variable "initial_allowlist" {
  description = "Comma-separated addresses written to the allowlist parameter on first apply only. Terraform ignores later changes to the value, so edit it with `aws ssm put-parameter --overwrite` rather than here."
  type        = string
  default     = ""
}
