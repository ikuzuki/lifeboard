# -----------------------------------------------------------------------------
# Web push: two digests a day, off by default
#
# See modules/push-scaffold for the shape and docs/design-brief-notifications.md
# for why it is that shape. count is zero unless enable_push is set, so a normal
# apply creates nothing here.
#
# Before the first plan with enable_push true, run
# infrastructure/lambdas/push_dispatch/build.sh: the module archives build/ as it
# finds it, and pywebpush has to be in there.
#
# After the first apply, put the VAPID pair into the two SSM parameters the
# outputs below name. Until then the dispatcher runs, fails to send, and logs it.
# -----------------------------------------------------------------------------
module "push" {
  # The digests are read from the per-user bucket, which only exists with auth on.
  count  = var.enable_push && var.enable_auth ? 1 : 0
  source = "../../modules/push-scaffold"

  environment   = var.environment
  source_dir    = "../../lambdas/push_dispatch"
  secret_prefix = var.secret_prefix

  user_data_bucket_arn  = one(module.user_data[*].bucket_arn)
  user_data_bucket_name = one(module.user_data[*].bucket_name)

  # The `sub` claim a push service sees. The app's own URL rather than an address:
  # it identifies the sender just as well and puts no inbox in a JWT that FCM,
  # Mozilla and Apple all get to read.
  vapid_subject = module.web_hosting.site_url
}

output "push_vapid_private_key_parameter" {
  description = "SSM parameter to populate with the VAPID private key. Terraform creates it holding REPLACE_ME and never reads it back."
  value       = one(module.push[*].vapid_private_key_parameter)
}

output "push_vapid_public_key_parameter" {
  description = "SSM parameter to populate with the VAPID public key. The same value goes into the client build as VITE_VAPID_PUBLIC_KEY."
  value       = one(module.push[*].vapid_public_key_parameter)
}

output "push_log_group" {
  description = "Lambda log group carrying one push_dispatch line per send window."
  value       = one(module.push[*].log_group_name)
}
