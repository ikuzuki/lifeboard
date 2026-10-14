# auth

Cognito user pool federated to Google, plus the identity pool that exchanges the
resulting ID token for temporary AWS credentials.

```
Browser ──► hosted UI ──► Google ──► user pool ──► identity pool ──► STS
```

Email is the linking attribute. The app client is public: no secret,
authorisation code flow with PKCE, implicit flow not enabled. Callback and logout
URLs are variables so `http://localhost:5173` can sign in against the same pool.
Unauthenticated identities are disabled.

`user_pool_domain_prefix` is globally unique across all AWS accounts, and the
Google redirect URI that must be registered on the Google side is emitted as
`google_redirect_uri`. How to obtain the Google credentials, and the caveat about
account linking, are in [`../../README.md`](../../README.md).

## Inputs

| Name | Description | Type | Default |
|------|-------------|------|---------|
| `environment` | Deployment environment (dev/prod) | `string` | n/a |
| `project` | Name prefix for resources | `string` | `lifeboard` |
| `user_pool_domain_prefix` | Hosted UI domain prefix | `string` | n/a |
| `google_client_id` | Google OAuth client ID (sensitive) | `string` | n/a |
| `google_client_secret` | Google OAuth client secret (sensitive) | `string` | n/a |
| `callback_urls` | Post sign-in redirect allowlist | `list(string)` | n/a |
| `logout_urls` | Post sign-out redirect allowlist | `list(string)` | n/a |
| `oauth_scopes` | Scopes the app client may request | `list(string)` | `["openid","email","profile"]` |
| `google_authorize_scopes` | Scopes requested from Google | `string` | `openid email profile` |
| `allow_cognito_native_signin` | Also offer username and password | `bool` | `false` |
| `allow_self_signup` | Allow public self-registration | `bool` | `false` |
| `access_token_validity_minutes` | Access and ID token lifetime | `number` | `60` |
| `refresh_token_validity_days` | Refresh token lifetime | `number` | `30` |

## Outputs

| Name | Description |
|------|-------------|
| `user_pool_id` | User pool ID |
| `user_pool_arn` | User pool ARN |
| `user_pool_client_id` | Public app client ID |
| `identity_pool_id` | Identity pool ID |
| `hosted_ui_domain` | Fully qualified hosted UI domain |
| `hosted_ui_login_url` | Ready-made login URL for testing the Google flow |
| `google_redirect_uri` | Register on the Google OAuth client |
| `google_javascript_origin` | Register on the Google OAuth client |
