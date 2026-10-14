# Lifeboard infrastructure

Terraform for hosting Lifeboard on AWS as a single-user app that can grow into a
small multi-user one without a re-architecture. Region `eu-west-2`; the
commands below assume `AWS_PROFILE` points at the account you deploy to.

The shape is deliberately serverless and stateless on the server side. There is
no API, no database and no compute in the request path: the browser gets the
built app from CloudFront, signs in through Cognito, and reads and writes its
own state document straight to S3 using temporary credentials scoped to its own
prefix. Adding a user adds a prefix, not a tenant.

```
Browser
  ├── CloudFront ──► S3  lifeboard-app-{env}          the built app
  ├── Cognito hosted UI ──► Google                    sign-in
  ├── Cognito identity pool ──► STS                   temporary credentials
  └── S3  lifeboard-user-data-{env}                   users/{identity-id}/state.json
```

## Layout

Mirrors [`fpl-platform/infrastructure`](https://github.com/ikuzuki/fpl-platform/tree/main/infrastructure): a `bootstrap` root that creates the state
backend, reusable modules under `modules/`, and one root per environment under
`environments/`.

| Path | What it is |
|------|------------|
| `bootstrap/` | State bucket, DynamoDB lock table, cost budgets, optional GitHub OIDC deploy role. Applied once, with local state. |
| `modules/web-hosting/` | S3 bucket for the built app, CloudFront with origin access control, TLS, SPA error mapping, and the cache split. |
| `modules/auth/` | Cognito user pool federated to Google, hosted UI domain, public app client, identity pool. |
| `modules/user-data/` | Private versioned S3 bucket for per-user state, its CORS rules, and the IAM role that enforces per-user isolation. |
| `modules/push-scaffold/` | The web push dispatcher, its two Europe/London schedules and its VAPID parameters. Off by default. |
| `environments/dev/` | The only applied root. |
| `environments/prod/` | Declared, not applied. See the comment at the top of its `main.tf`. |

## What each module does

### web-hosting

A private S3 bucket holding the Vite build output, read by CloudFront through an
origin access control. OAC rather than the legacy OAI: CloudFront signs origin
requests with SigV4, the bucket policy trusts exactly one distribution ARN, and
nothing is public.

SPA routing comes from mapping both 403 and 404 to `/index.html` with a 200.
S3 answers 404 for a key that does not exist and 403 for one the policy does not
cover, and a client-side route such as `/goals` is neither, so both need the
mapping. `error_caching_min_ttl` is zero so a genuinely missing asset is not
pinned at the edge.

The cache split runs the opposite way to the usual default. The *default*
behaviour is no-cache, and only `/assets/*` gets the one-year immutable
treatment. Vite writes content-hashed filenames into `dist/assets/`, so those
keys change on every build and can be cached forever; `index.html`, the service
worker, the web manifest and every SPA route must not be, or a deploy stays
invisible until the TTL lapses. Making the safe side the default means an
unhashed file added later is stale-proof without anyone remembering to add a
path pattern. Two response headers policies set `Cache-Control` with
`override = true`, because the cache policy governs the edge and the header
governs the browser, and the browser is the one that serves a stale service
worker.

Note that `default_root_object` only rewrites the origin request for `/`. Cache
behaviour is still matched on the viewer path `/`, so an ordered behaviour on
`/index.html` would have missed the home page. That is why the default is the
no-cache one rather than the exception.

The custom domain is optional. With `domain_name` unset the module receives an
empty alias list and a null certificate ARN, CloudFront serves its own
`*.cloudfront.net` name, and nothing in `domain.tf` is created. This is the
supported state on an account with no hosted zone.

### auth

A Cognito user pool with Google as a federated identity provider, and an
identity pool that exchanges the resulting ID token for temporary AWS
credentials.

Email is the linking attribute: `username_attributes = ["email"]` makes the
address the sign-in identifier, and the Google attribute mapping writes Google's
verified email onto the federated user. Be clear about what that does not do.
Cognito will not merge a native account and a Google account sharing an address
into a single identity unless a pre-sign-up Lambda trigger calls
`AdminLinkProviderForUser`. No such trigger is built, because native sign-in is
off by default and there is therefore nothing to merge. Turn
`allow_cognito_native_signin` on and that gap becomes real.

The app client is public: no secret, authorisation code flow with PKCE, implicit
flow deliberately not enabled. Callback and logout URLs come from variables and
include `http://localhost:5173`, so the dev server signs in against the same
pool rather than a mock.

`server_side_token_check` is on, so Cognito verifies the user still exists on
every credential request and deleting a user revokes access immediately instead
of waiting out the refresh token.

### user-data

A private S3 bucket, versioned, one document per user under
`users/{identity-id}/`. Versioning is the recovery path for a bad write: the
client does a read-modify-write of a whole document, so a truncated or malformed
put would otherwise be terminal. Noncurrent versions expire after 30 days by
default, abandoned multipart uploads after 7, and orphaned delete markers are
cleared.

CORS allows the CloudFront origin and `http://localhost:5173`, and exposes
`ETag`. That last part is load-bearing. `ETag` is not a CORS-safelisted response
header, so without `expose_headers` the client can read the body but not the
tag, and a conditional write has nothing to put in `If-Match`. The failure mode
is silent: the write path quietly degrades to last-writer-wins.

**The IAM role is the entire security model.** Two independent gates, both of
which must hold:

The trust policy admits only the Cognito identity broker, only via
`AssumeRoleWithWebIdentity`, only for identities minted by *this* identity pool
(`cognito-identity.amazonaws.com:aud`), and only where the authentication method
was `authenticated` rather than anonymous
(`ForAnyValue:StringLike` on `:amr`). Without the `:aud` pin, an identity from
any other identity pool in any AWS account could assume the role, so that
condition is not decoration.

The permissions policy grants `s3:GetObject` and `s3:PutObject` on
`users/${cognito-identity.amazonaws.com:sub}/*` and nothing else. That string is
an IAM policy variable, substituted per request with the caller's Cognito
identity ID, so the credentials handed to user A are structurally incapable of
naming user B's prefix. It is not a check the client performs and it cannot be
bypassed by crafting a key. In the Terraform source it is written `$${...}` so
that Terraform emits the literal rather than trying to interpolate it; a single
`$` there would either fail the plan or, worse, resolve to a constant that gave
everyone the same prefix.

Absent on purpose: `s3:DeleteObject`, because the app soft-deletes inside the
document and withholding delete means a stolen token cannot destroy the user's
own data either; and `s3:ListBucket`, because it is a bucket-level action that
cannot be scoped by object key and the client already knows its own key. If
listing is ever needed it must go in a separate statement on the bucket ARN with
an `s3:prefix` condition. That is the one change most likely to widen this
policy by accident.

### push-scaffold

Two digests a day, both suppressed when there is nothing to say: a Lambda, one
EventBridge Scheduler schedule per send window, and two SSM parameters for the
VAPID pair. `enable_push` defaults to false and a normal apply creates none of
it.

The dispatcher reads a per-user digest of counts and dates, never the state
document, and its policy names `users/*/digest.json` and `users/*/push/*` so that
this is enforced rather than intended. The one write-shaped permission is
`s3:DeleteObject` on `users/*/push/*`, for a subscription a push service has
answered 404 or 410 for.

Scheduler rather than a CloudWatch event rule buys `schedule_expression_timezone`,
which keeps 07:30 at 07:30 across the BST transition. There is no subscription
API: the browser writes its own subscription record under its own prefix, which
the authenticated role already allows.

Two things it needs before it does anything: a VAPID pair generated by hand into
the parameters (see the module README) and `lambdas/push_dispatch/build.sh` having
run.

## Before you apply anything

### 1. A Google OAuth client

Terraform takes the client ID and secret as sensitive variables and will not
create them for you.

The redirect URI Google needs depends on the Cognito hosted UI domain, which
Terraform creates, which needs the client ID. The circle breaks because the
domain is deterministic: it is
`https://{user_pool_domain_prefix}.auth.eu-west-2.amazoncognito.com`, so with
the default prefix the redirect URI is

```
https://lifeboard-dev.auth.eu-west-2.amazoncognito.com/oauth2/idpresponse
```

Steps in the Google Cloud console at <https://console.cloud.google.com>:

1. Create or select a project.
2. **APIs & Services, OAuth consent screen.** User type External. Fill in app
   name, user support email and developer contact. Add the scopes
   `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. While
   the app stays in Testing, add your own Google account as a test user;
   otherwise sign-in fails with `access_denied` and nothing in AWS shows why.
3. **APIs & Services, Credentials, Create credentials, OAuth client ID.**
   Application type **Web application**.
4. Authorised JavaScript origins:
   `https://lifeboard-dev.auth.eu-west-2.amazoncognito.com`
5. Authorised redirect URIs: the `/oauth2/idpresponse` URL above. It must match
   exactly, or Google rejects the sign-in with `redirect_uri_mismatch`.
6. Copy the client ID and client secret.

After the first apply, `terraform output google_redirect_uri` and
`google_javascript_origin` print the values to check against what you
registered.

Store the credentials once, in Parameter Store. Terraform reads them from there,
so they are never typed again and never held in a GitHub secret that cannot be
read back. `MSYS_NO_PATHCONV=1` stops Git Bash rewriting the leading slash into a
Windows path.

```bash
MSYS_NO_PATHCONV=1 aws ssm put-parameter --type String --overwrite   --name /lifeboard/dev/google-client-id --value '....apps.googleusercontent.com'
```

```bash
MSYS_NO_PATHCONV=1 aws ssm put-parameter --type SecureString --overwrite   --name /lifeboard/dev/google-client-secret --value 'GOCSPX-....'
```

Non-secret environment config is committed as `dev.auto.tfvars`, so a laptop and CI
apply the same thing; `infrastructure/.gitignore` excludes only `terraform.tfvars`
and `secrets.auto.tfvars`.

### 2. Only if you want a custom domain

Nothing below is needed to run on the `*.cloudfront.net` address.

A Route 53 hosted zone for the parent domain must already exist in this account.
`domain.tf` looks it up by name rather than creating it, because the zone is
usually shared with other subdomains.

The ACM certificate is created by Terraform, not by hand, but it has to live in
`us-east-1` because that is the only region CloudFront reads certificates from.
The `aws.us_east_1` provider alias in `main.tf` handles that. DNS validation
records are written into the hosted zone automatically, and
`aws_acm_certificate_validation` blocks until the certificate is ISSUED, so
CloudFront never attaches an unvalidated certificate.

Set both `domain_name` and `route53_zone_name`; a validation rule rejects one
without the other.

### 3. A note on sharing an account

I deploy this into the same account as
[`fpl-platform`](https://github.com/ikuzuki/fpl-platform). Two things follow.

The bootstrap root here creates a second state bucket and lock table
(`lifeboard-dev-tf-state`, `lifeboard-dev-tf-lock-table`). That is the clean
separation, but you could equally skip this root and point the backend block in
`environments/dev/main.tf` at an existing state bucket with key
`lifeboard/dev/terraform.tfstate`.

AWS gives two free budgets per account and the other stack already uses both, so
the two budgets created here cost roughly $0.02 per day each, about $1.20 a
month, which is more than everything else in this stack combined at one user. If
you would rather not pay that, delete the `aws_budgets_budget` resources from
`bootstrap/main.tf` and rely on the account-wide budgets you already have.

## Apply order

```bash
export AWS_PROFILE=<your-profile>
aws sso login
```

**1. Bootstrap**, once. Local state, so it has to come first.

```bash
cd infrastructure/bootstrap
cp terraform.tfvars.example terraform.tfvars   # then edit it
terraform init
terraform plan
terraform apply
```

**2. Dev environment.** The backend block refers to the bucket and table the
bootstrap step just created.

```bash
cd infrastructure/environments/dev
cp terraform.tfvars.example terraform.tfvars   # then edit it
terraform init
terraform plan
terraform apply
```

Everything inside this root applies in one pass. Terraform resolves the ordering
that matters: the identity pool exists before the IAM role that trusts it, the
role exists before the roles attachment, and the certificate is validated before
CloudFront attaches it. Expect roughly 15 minutes, almost all of it CloudFront.

**3. Deploy the app.**

```bash
npm run build
aws s3 sync dist/ s3://$(terraform -chdir=infrastructure/environments/dev output -raw app_bucket_name) --delete
aws cloudfront create-invalidation \
  --distribution-id $(terraform -chdir=infrastructure/environments/dev output -raw cloudfront_distribution_id) \
  --paths "/index.html" "/sw.js"
```

The invalidation is belt and braces. Hashed assets never need it and everything
else is already no-cache, so `/*` is unnecessary.

**4. Wire the client.** `terraform output frontend_config` prints every value
the app needs in one object. None of it is secret: the client IDs are public
identifiers and the AWS credentials are minted per session by the identity pool.

## Required variables

Roots read these; modules have more knobs, documented in their own
`variables.tf`.

### bootstrap

| Variable | Required | Default | Notes |
|---|---|---|---|
| `notification_email` | yes | n/a | Where budget alerts go. |
| `environment` | no | `dev` | |
| `enable_github_oidc` | no | `false` | Off until there is a CI pipeline; the role carries `AdministratorAccess`. |
| `github_repo` | no | `ikuzuki/lifeboard` | Only read when OIDC is on. |
| `monthly_budget_limit_usd` | no | `5` | |

### environments/dev

| Variable | Required | Default | Notes |
|---|---|---|---|
| `secret_prefix` | no | `/lifeboard` | Parameter Store prefix. The Google credentials live at `{prefix}/{environment}/google-client-{id,secret}` and are read, not passed in. |
| `user_pool_domain_prefix` | no | `lifeboard-dev` | Globally unique across all AWS accounts. |
| `environment` | no | `dev` | |
| `domain_name` | no | `null` | Null keeps the app on `*.cloudfront.net`. |
| `route53_zone_name` | no | `null` | Required whenever `domain_name` is set. |
| `dev_server_origin` | no | `http://localhost:5173` | Added to callbacks and CORS. |
| `bucket_suffix` | no | `""` | Set only if a bucket name is globally taken. |
| `enable_push` | no | `false` | Needs `enable_auth`, a VAPID pair in Parameter Store and a client that subscribes. |

## Estimated monthly cost

Estimates, not quotes, and every one of them should be checked against the AWS
pricing pages before being relied on. Sterling at roughly 0.79 to the dollar.

**One user, no custom domain: effectively zero, plus the budgets.**

CloudFront's perpetual free tier covers 1 TB of egress and 10 million requests a
month, which one user will not approach. S3 storage for a built app and a
handful of state documents is a few megabytes, under a penny. Cognito is free at
this scale under the current free tiers, though Cognito was repriced in late
2024 into Lite, Essentials and Plus tiers and the hosted UI's availability
differs between them, so confirm before assuming. Terraform state in S3 and
DynamoDB on-demand is pennies. The real line item is the two AWS budgets at
about $1.20 a month if the account's two free budgets are already spoken for,
which on my shared account they are.

Add a custom domain and it is $0.50 a month for the Route 53 hosted zone plus
whatever the domain registration costs annually. ACM certificates are free.

Call it **£0 to £1.50 a month**, dominated by things that are not really the app.

**One thousand users: roughly £6 to £10 a month, and it is all S3 PUT requests.**

Storage stays trivial: a thousand state documents at a couple of hundred
kilobytes each is around 200 MB, under a penny a month even with versioning.
CloudFront stays inside the free tier unless usage is far heavier than expected.
Cognito at 1,000 monthly active users remains inside the free tier under current
pricing.

The cost is writes. A thousand users saving fifty times a day is 1.5 million
PUTs a month at $0.005 per thousand, about $7.50. GETs at the same volume are
about $0.60. So the single lever that matters is how aggressively the client
debounces: batching a burst of edits into one write per few seconds instead of
one per keystroke is the difference between £6 and £60. Worth knowing before the
client's sync layer is written, not after.

Versioning multiplies storage by the number of retained versions, which is why
`noncurrent_version_expiration_days` exists. At 30 days and fifty writes a day
that is 1,500 versions per user, so if the write rate is anywhere near that,
lower the retention or the storage line stops being trivial.

## Teardown

`terraform destroy` will not get you all the way, on purpose. Neither S3 bucket
sets `force_destroy`, so Terraform refuses to delete a bucket with objects in
it. That is the guard against a stray destroy taking the user data with it.

```bash
cd infrastructure/environments/dev

# 1. Empty the app bucket.
aws s3 rm s3://$(terraform output -raw app_bucket_name) --recursive

# 2. Take a copy of the user data before emptying it. Once the versions are
#    gone they are gone.
aws s3 sync s3://$(terraform output -raw user_data_bucket_name) ./user-data-backup

# 3. Empty the user data bucket, versions and delete markers included. The
#    recursive rm above only removes current versions; a versioned bucket
#    still refuses to delete afterwards.
aws s3api delete-objects \
  --bucket $(terraform output -raw user_data_bucket_name) \
  --delete "$(aws s3api list-object-versions \
      --bucket $(terraform output -raw user_data_bucket_name) \
      --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
      --output json)"
aws s3api delete-objects \
  --bucket $(terraform output -raw user_data_bucket_name) \
  --delete "$(aws s3api list-object-versions \
      --bucket $(terraform output -raw user_data_bucket_name) \
      --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
      --output json)"

# 4. Destroy the stack. CloudFront is disabled then deleted, which takes
#    around 15 minutes on its own.
terraform destroy
```

Then, if you are removing the project entirely:

```bash
cd ../../bootstrap
aws s3 rm s3://lifeboard-dev-tf-state --recursive     # versioned, see above
terraform destroy
```

Outside Terraform, delete the OAuth client in the Google Cloud console. It
survives the AWS teardown and keeps working against whatever redirect URI is
still registered.

If the hosted UI domain prefix is being reused for a fresh deployment, note that
Cognito holds a deleted domain prefix for a while before releasing it, so an
immediate re-apply with the same prefix can fail.
