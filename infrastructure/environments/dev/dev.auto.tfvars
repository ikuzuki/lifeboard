# Dev environment configuration. Committed on purpose, and auto-loaded by Terraform, so a
# laptop and CI apply the same thing. None of it is secret: the Google OAuth credentials are
# read from Parameter Store by auth.tf and the Anthropic key never leaves SSM.
#
# Before this file existed all of it lived in a gitignored terraform.tfvars, which meant CI
# applied the variable defaults instead. That plan destroyed the ACM certificate and the
# Route53 records and replaced the Cognito hosted UI domain, which would have taken the app
# off its domain and invalidated the redirect URI registered with Google.

environment = "dev"

# Custom domain. Null here would move the app to the CloudFront hostname.
domain_name       = "lifeboard.isseikuzuki.co.uk"
route53_zone_name = "isseikuzuki.co.uk"

# Globally unique across all AWS accounts, and baked into the Google client's redirect URI
# as https://{prefix}.auth.eu-west-2.amazoncognito.com/oauth2/idpresponse. Changing it
# replaces the domain and breaks sign-in until Google is updated to match.
user_pool_domain_prefix = "lifeboard-ik-dev"

enable_auth = true

# On, and stated here rather than left to the default of false, which exists so a fresh
# environment does not silently start costing per use.
enable_capture = true

# initial_allowlist is deliberately absent. It seeds the SSM parameter on first create only,
# and that parameter carries ignore_changes on its value, so the live list is edited out of
# band with one CLI call. See modules/auth/allowlist.tf for the command.

# Anthropic spend ceilings. The global one binds first once more than one person is using
# the brain dump: five people at two dollars each cannot all spend it.
capture_monthly_limit_usd      = 5
capture_user_monthly_limit_usd = 2

# Web push. Needs the VAPID pair filled into SSM after the first apply, and the client
# rebuilt so the public key is baked in.
enable_push = true
