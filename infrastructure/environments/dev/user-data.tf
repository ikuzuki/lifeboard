# -----------------------------------------------------------------------------
# User data store: private per-user state documents in S3
#
# CORS allows the deployed origin and the local dev server. The dev server is
# in the list on purpose: without it, local development would have to run
# against a second bucket or fake the storage layer, and the conditional-write
# path is exactly the sort of thing a fake hides.
# -----------------------------------------------------------------------------
module "user_data" {
  count  = var.enable_auth ? 1 : 0
  source = "../../modules/user-data"

  environment   = var.environment
  bucket_suffix = var.bucket_suffix

  identity_pool_id     = local.identity_pool_id
  cors_allowed_origins = local.app_origins
}
