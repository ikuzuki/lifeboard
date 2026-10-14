# Prod environment: Terraform stub

**Status: declared, not applied.**

Lifeboard runs dev-only on a personal AWS account. This directory holds the
backend configuration, provider, tags and the `environment` variable so the
prod root exists, and nothing else.

The service-level files that dev has (`web.tf`, `domain.tf`, `auth.tf`,
`user-data.tf`, `push.tf`, `outputs.tf`) are not duplicated here. Every module
call in them already takes `environment = var.environment`, so they are
copy-ready: what changes between dev and prod is the state backend, the tfvars
and the AWS profile, not the set of modules. Duplicating them unapplied would
create a second copy that the next dev-only change silently falsifies.

Lifting to a real deployment is the numbered list at the top of
[`main.tf`](main.tf). The one step that is not mechanical is the Google OAuth
client: prod needs its own, registered against the prod hosted UI domain, rather
than sharing dev's credential across both environments.
