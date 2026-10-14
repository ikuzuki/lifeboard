# -----------------------------------------------------------------------------
# Brain dump parsing: the one place this app pays a model
#
# Off by default. Turning it on creates an HTTP API, a Lambda and an empty SSM
# SecureString, so the switch is deliberate rather than a side effect of an
# unrelated apply. With it off, the client sees no VITE_CAPTURE_ENDPOINT and hides
# the surface entirely.
#
# Before the first plan with enable_capture true, run
# infrastructure/lambdas/parse_capture/build.sh: the module archives build/ as it
# finds it, and a missing build/ fails at plan.
#
# The variable and outputs live in this file rather than in variables.tf and
# outputs.tf, against the convention in this root, so that adding or removing the
# feature touches exactly one file. Fold them into the shared files if the feature
# becomes permanent.
# -----------------------------------------------------------------------------
variable "enable_capture" {
  description = "Create the brain dump parsing API. Off by default: it is the only component that costs per use."
  type        = bool
  default     = false
}

module "capture" {
  # Capture authorises on a Cognito JWT, so it cannot exist without auth.
  count  = var.enable_capture && var.enable_auth ? 1 : 0
  source = "../../modules/capture-api"

  secret_prefix = var.secret_prefix

  monthly_limit_usd      = var.capture_monthly_limit_usd
  user_monthly_limit_usd = var.capture_user_monthly_limit_usd

  environment = var.environment
  source_dir  = "../../lambdas/parse_capture"

  user_pool_id        = local.user_pool_id
  user_pool_client_id = local.user_pool_client_id

  # Same origin set the hosted UI trusts, minus the trailing-slash variants that
  # only matter to Cognito's exact redirect_uri match. A browser sends Origin
  # without a path, so the bare origins are the correct list here.
  allowed_origins = local.app_origins
}

output "capture_endpoint" {
  description = "Base URL for the capture API, or null when disabled. Set as VITE_CAPTURE_ENDPOINT in the client build."
  value       = one(module.capture[*].endpoint)
}

output "capture_api_key_parameter" {
  description = "SSM parameter to populate with the real Anthropic API key. Terraform creates it holding REPLACE_ME and never reads it back."
  value       = one(module.capture[*].api_key_parameter_name)
}

output "capture_log_group" {
  description = "Lambda log group carrying the capture_usage token lines."
  value       = one(module.capture[*].log_group_name)
}
