# user-data

Private, versioned S3 bucket holding one state document per user, and the IAM
role that makes cross-user access impossible rather than merely discouraged.

```
users/{cognito-identity-id}/state.json
```

The role's trust policy admits only the Cognito identity broker, only via
`AssumeRoleWithWebIdentity`, only for identities from this identity pool, and
only when authenticated. Its permissions policy grants `s3:GetObject` and
`s3:PutObject` on `users/${cognito-identity.amazonaws.com:sub}/*` and nothing
else, using the IAM policy variable so the credentials issued to one user cannot
name another user's prefix. `s3:DeleteObject` and `s3:ListBucket` are omitted
deliberately; the reasoning, and the escaping trap in the Terraform source, are
in [`../../README.md`](../../README.md).

CORS exposes `ETag` because the client relies on conditional writes and `ETag` is
not CORS-safelisted. Versioning plus a noncurrent-version expiry is the recovery
path for a bad write.

## Inputs

| Name | Description | Type | Default |
|------|-------------|------|---------|
| `environment` | Deployment environment (dev/prod) | `string` | n/a |
| `project` | Name prefix for resources | `string` | `lifeboard` |
| `bucket_suffix` | Suffix for global bucket-name uniqueness | `string` | `""` |
| `identity_pool_id` | Pinned in the trust policy as `:aud` | `string` | n/a |
| `cors_allowed_origins` | Browser origins permitted to call the bucket | `list(string)` | n/a |
| `cors_max_age_seconds` | Preflight cache lifetime | `number` | `3600` |
| `noncurrent_version_expiration_days` | Recovery window for a bad write | `number` | `30` |
| `abort_incomplete_multipart_days` | Cleanup for abandoned uploads | `number` | `7` |

## Outputs

| Name | Description |
|------|-------------|
| `bucket_name` | Per-user state bucket |
| `bucket_arn` | Bucket ARN |
| `authenticated_role_arn` | Role for the identity pool roles attachment |
| `authenticated_role_name` | Role name |
| `key_template` | Key shape the client must write |
