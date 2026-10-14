# push-scaffold

Two scheduled digests a day, both suppressed when there is nothing to say. Gated
behind `enable_push`, which defaults to false, so a normal apply creates nothing
here.

What it creates: the dispatcher Lambda and its log group, an execution role that
can read `users/*/digest.json` and `users/*/push/*` and delete under
`users/*/push/*`, two SSM parameters for the VAPID pair, and one EventBridge
Scheduler schedule per send window with a role for Scheduler to invoke through.

There is no subscription API. The browser writes its own subscription record to
its own prefix in the user-data bucket, which the authenticated role already
allows, so an API here would rebuild `capture-api` for something S3 does for
nothing. See `docs/design-brief-notifications.md` for the digest contract, the
send conditions, and the reasoning behind both.

## What the dispatcher reads, and what it cannot

A per-user **digest** and nothing else. A digest carries counts and dates; the
state document carries every title and description, and the dispatcher has no
business seeing them. The read policy names `users/*/digest.json` and
`users/*/push/*`, and a wildcard in the middle of a key is valid in an S3 ARN, so
this genuinely cannot name `state.json`.

The list permission is split in two for the same reason. Enumerating identities
is a delimited list of `users/`, which answers with prefixes and no object keys;
the second statement covers listing one user's `push/` records. Neither can be
turned into an inventory of what someone owns.

The one write-shaped permission is `s3:DeleteObject` on `users/*/push/*`. A push
service answering 404 or 410 means that subscription is gone for good, and the
record has to go with it or every window pays for a device that no longer exists.
Scoped to Delete alone on that prefix, the dispatcher still cannot touch
`digest.json` or `state.json`.

## The send windows

`aws_scheduler_schedule` rather than a classic CloudWatch event rule, for one
attribute: `schedule_expression_timezone`. Scheduler evaluates a named IANA zone
and handles daylight saving itself, so 07:30 stays 07:30 across the BST
transition. A UTC cron would be an hour out for half the year.

The cost of that choice is that the times are Terraform variables, so changing
them is an apply. Set `send_windows` to move them; the keys are the slot the
handler receives and only `morning` and `evening` are accepted.

## The VAPID pair: a one-off, by hand

Terraform creates both parameters holding `REPLACE_ME` with
`lifecycle.ignore_changes = [value]`, so neither key ever reaches state and later
applies leave the real values alone. Generate the pair locally; nothing about
VAPID needs an AWS or an Apple account.

```sh
uvx --from py-vapid vapid --gen  # writes private_key.pem and public_key.pem here
uvx --from py-vapid vapid --applicationServerKey  # prints the browser's key
```

The private key goes into SSM as the PEM that writes, newlines and all; the handler also
accepts the bare base64url form if the pair came from somewhere else.

Then populate both parameters. `MSYS_NO_PATHCONV=1` is for Git Bash, which
otherwise rewrites the leading slash of the parameter name into a Windows path.

```sh
MSYS_NO_PATHCONV=1 aws ssm put-parameter --region eu-west-2 \
  --name /lifeboard/dev/vapid-private-key --type SecureString --overwrite \
  --value "$(cat private_key.pem)"

MSYS_NO_PATHCONV=1 aws ssm put-parameter --region eu-west-2 \
  --name /lifeboard/dev/vapid-public-key --type String --overwrite \
  --value "BA...the applicationServerKey..."
```

The public key also has to reach the browser as `VITE_VAPID_PUBLIC_KEY`, which is
the same value: it is public by construction, since it is what
`pushManager.subscribe()` is called with. Rotating the pair invalidates every
subscription on every device, so treat this as a one-time generation rather than
as a credential to rotate.

Until the parameters hold real keys the dispatcher runs, fails to send, and says
so in its log.

## Building the package

`data.archive_file` zips `build/` as it finds it, so run the build before the
first plan and again after any change to the handler or its requirements:

```sh
infrastructure/lambdas/push_dispatch/build.sh
```

## Inputs

| Name | Description | Type | Default |
|------|-------------|------|---------|
| `environment` | Deployment environment (dev/prod) | `string` | n/a |
| `project` | Name prefix for resources | `string` | `lifeboard` |
| `source_dir` | Directory holding the dispatcher and its `build/` | `string` | n/a |
| `secret_prefix` | Parameter Store path prefix | `string` | `/lifeboard` |
| `send_windows` | Cron per slot, evaluated in Europe/London | `map(string)` | 07:30 and 20:30 |
| `user_data_bucket_arn` | Bucket the dispatcher may read | `string` | n/a |
| `user_data_bucket_name` | Same bucket, for its own S3 calls | `string` | n/a |
| `vapid_subject` | VAPID `sub` claim: `mailto:` or `https://` | `string` | n/a |
| `memory_size` | Dispatcher memory | `number` | `256` |
| `timeout` | Dispatcher timeout, seconds | `number` | `60` |
| `log_retention_days` | CloudWatch retention | `number` | `30` |

## Outputs

| Name | Description |
|------|-------------|
| `function_name` | Dispatcher Lambda name |
| `function_arn` | Dispatcher Lambda ARN |
| `role_arn` | Execution role ARN |
| `log_group_name` | Log group carrying the per-window summary line |
| `vapid_private_key_parameter` | Parameter to populate with the private key |
| `vapid_public_key_parameter` | Parameter to populate with the public key |
| `schedule_names` | Schedule name per slot |
