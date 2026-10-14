# capture-api

One Lambda holding the Anthropic API key, behind an HTTP API with a Cognito JWT
authorizer. It turns a brain dump into draft items and returns them; it stores
nothing and decides nothing.

```
Browser ──POST /capture, Authorization: Bearer {Cognito ID token}
   │
   ├─ HTTP API + JWT authorizer      token validated at the edge, before billing
   ├─ Lambda  lifeboard-{env}-capture
   │     ├─ SSM  {prefix}/{env}/anthropic-api-key   read once per cold start
   │     └─ api.anthropic.com  claude-haiku-4-5, structured output
   └─ 200 {"items": [...]}  |  400 bad request  |  502 parsing unavailable
```

## Why an HTTP API and not a Function URL

A Function URL's `authorization_type` is `AWS_IAM` or `NONE`, and that is the whole
list. There is no Cognito authorizer for one. The alternatives were SigV4 from the
browser using the identity pool's temporary credentials, which means shipping a
signing SDK and maintaining a second auth path next to the token the client already
holds, or a shared-secret header, which authenticates a deployment rather than a
person. The HTTP API JWT authorizer validates the token before the Lambda runs, so a
bad token costs nothing.

The authorizer matches `aud` against the app client ID, and only ID tokens carry the
client ID in `aud` (access tokens use `client_id`). **The client must send the ID
token.** Sending an access token returns 401 with no useful detail, which is the most
likely first-run failure.

## The key

A SecureString parameter at `{secret_prefix}/{environment}/anthropic-api-key`,
created holding `REPLACE_ME` with `lifecycle.ignore_changes = [value]`, populated by
hand in the Console after the first apply. The Lambda reads it at cold start into
`os.environ["ANTHROPIC_API_KEY"]` and the SDK picks it up from there.

It is deliberately not a Lambda environment variable: that would put it in Terraform
state and in `lambda:GetFunctionConfiguration` output. It is never logged, and the
handler never returns it in an error body.

Encryption uses the default `alias/aws/ssm` key, so there is no `kms:Decrypt`
statement on the role. That key's policy grants Decrypt to in-account principals
calling through SSM, which is this read path exactly. **A customer-managed key would
need an explicit `kms:Decrypt` on the key ARN**, and its absence is the change most
likely to break this quietly.

With the parameter still at its placeholder, the Lambda runs, the Anthropic call
fails, the handler returns 502, and the client falls back to putting the raw text in
a title. Unconfigured degrades; it does not crash.

## Build before plan

The deployment package is a zip built by `lambdas/parse_capture/build.sh`, which pip
installs `anthropic` into `build/` for `manylinux2014_x86_64` and copies the handler
in beside it. Terraform archives `build/` as it finds it, so:

```bash
infrastructure/lambdas/parse_capture/build.sh
terraform -chdir=infrastructure/environments/dev plan
```

Re-run it after any change to `handler.py` or `requirements.txt`;
`source_code_hash` picks the change up from there. `build/` and `handler.zip` are
gitignored. This is a script rather than a `null_resource` so a failed dependency
install is visible where it happens instead of buried in a Terraform log.

## Cost controls

Three, in order of how hard they bite:

`reserved_concurrent_executions` (default 2) is the real backstop. It bounds how many
model calls can be in flight at once, so a looping client cannot run up a bill no
matter how fast it retries.

Stage throttling (5/s steady, 10 burst) rejects excess at the edge, before Lambda.

`MAX_TOKENS` in the handler is 2048 against an expected 300, so a long dump cannot
truncate the JSON mid-item; it is headroom, not a budget.

Token usage is logged per call as a greppable `capture_usage model=... input_tokens=...`
line, which is what to read before believing any cost estimate.

## What is not here

No WAF and no per-user rate limiting. Reserved concurrency caps total spend but a
single authenticated user can still consume all of it; that is acceptable for one
person and is the first thing to add before the app is shared.

No prompt caching in effect. The handler sets `cache_control` on the static system
block, but the minimum cacheable prefix on Haiku 4.5 is 4096 tokens and that block is
roughly 350, so nothing is cached and `cache_write_tokens` logs zero. The declaration
is free and starts working if the prompt grows or the model changes.

No `plan` and no `apply` have been run against this module. `terraform validate` and
`terraform fmt` pass; that checks syntax, types and references, not that AWS accepts
any of it.
