# -----------------------------------------------------------------------------
# Web push: two scheduled digests a day, both suppressed when there is nothing
# to say
#
# One Lambda, two schedules, two SSM parameters and no API. The dispatcher lists
# the identity prefixes in the user-data bucket, reads each one's subscriptions
# and its digest, and sends over VAPID straight to the push service. There is no
# subscription endpoint because the browser already writes its own subscription
# record to its own prefix, so an API here would rebuild capture-api for
# something S3 does for nothing.
#
# The whole module is behind enable_push, which defaults to false, so a normal
# apply still creates none of it.
#
# See docs/design-brief-notifications.md for the digest contract, the send
# conditions and the reasoning behind both.
# -----------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

locals {
  name = "${var.project}-${var.environment}-push-dispatch"
}

# -----------------------------------------------------------------------------
# VAPID keys
#
# Shells holding REPLACE_ME, populated by hand after the first apply, exactly as
# capture-api does with the Anthropic key: ignore_changes means later applies
# leave the real values alone, and neither key ever reaches Terraform state.
#
# Encrypted with the default alias/aws/ssm key, which needs no kms:Decrypt grant
# of its own because that key policy already allows Decrypt for in-account
# principals reading through SSM.
#
# The pair is generated locally with py-vapid and never rotated in practice:
# rotating invalidates every subscription on every device, so treat it as a
# one-time generation. The public half is not a secret - it ships in the browser
# bundle as VITE_VAPID_PUBLIC_KEY - and is a String rather than a SecureString
# for that reason.
# -----------------------------------------------------------------------------
resource "aws_ssm_parameter" "vapid_private_key" {
  name        = "${var.secret_prefix}/${var.environment}/vapid-private-key"
  description = "VAPID private key, PEM. Read once per dispatcher cold start and never logged."
  type        = "SecureString"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "vapid_public_key" {
  name        = "${var.secret_prefix}/${var.environment}/vapid-public-key"
  description = "VAPID public key, base64url. Public by construction: it is the applicationServerKey the browser subscribes with."
  type        = "String"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

# -----------------------------------------------------------------------------
# Dispatcher
#
# Run lambdas/push_dispatch/build.sh before the first plan: the archive is taken
# from build/ as it is found, and pywebpush has to be vendored into it.
# -----------------------------------------------------------------------------
data "archive_file" "push_dispatch" {
  type        = "zip"
  source_dir  = "${var.source_dir}/build"
  output_path = "${var.source_dir}/handler.zip"
}

resource "aws_lambda_function" "push_dispatch" {
  function_name    = local.name
  description      = "Sends the morning and evening digests, or nothing at all."
  role             = aws_iam_role.push_dispatch.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  memory_size      = var.memory_size
  filename         = data.archive_file.push_dispatch.output_path
  source_code_hash = data.archive_file.push_dispatch.output_base64sha256

  # Every send is an HTTPS round trip to a push service, and a cold start adds an
  # SSM read on top. Generous rather than tight: the window runs twice a day and
  # a timeout loses a digest until the next one.
  timeout = var.timeout

  environment {
    variables = {
      ENV              = var.environment
      SECRET_PREFIX    = var.secret_prefix
      USER_DATA_BUCKET = var.user_data_bucket_name
      VAPID_SUBJECT    = var.vapid_subject
    }
  }
}

resource "aws_cloudwatch_log_group" "push_dispatch" {
  name              = "/aws/lambda/${aws_lambda_function.push_dispatch.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "push_dispatch" {
  name = "${local.name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "push_dispatch_basic" {
  role       = aws_iam_role.push_dispatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "push_dispatch_read_state" {
  name = "${var.project}-${var.environment}-push-dispatch-read-digests"
  role = aws_iam_role.push_dispatch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Digests and push subscriptions only, never the state document. A digest carries
      # counts and dates; the state document carries every title and description. Granting
      # `users/*` would have let the dispatcher read the lot, which is the one thing this
      # design is meant to make impossible rather than merely discouraged. A wildcard in
      # the middle of a key is valid in an S3 ARN, so this genuinely cannot name state.json.
      {
        Sid    = "ReadDigestsAndSubscriptions"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = [
          "${var.user_data_bucket_arn}/users/*/digest.json",
          "${var.user_data_bucket_arn}/users/*/push/*",
        ]
      },
      # Enumerating who exists, and nothing else. The delimiter condition is the teeth:
      # a delimited list of `users/` answers with the identity prefixes and no object
      # keys at all, so this cannot be turned into an inventory of what anyone owns.
      {
        Sid      = "ListIdentityPrefixes"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = var.user_data_bucket_arn
        Condition = {
          StringEquals = {
            "s3:prefix"    = ["users/"]
            "s3:delimiter" = ["/"]
          }
        }
      },
      {
        Sid      = "ListSubscriptions"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = var.user_data_bucket_arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["users/*/push/*"]
          }
        }
      },
      # 404 and 410 from a push service are permanent, so the subscription record has to
      # go or every window pays for a device that no longer exists. Scoped to the push
      # prefix and to Delete alone: the dispatcher can remove a dead subscription and
      # cannot write, overwrite or remove anything else, digest.json and state.json
      # included.
      {
        Sid      = "DeleteDeadSubscriptions"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = "${var.user_data_bucket_arn}/users/*/push/*"
      }
    ]
  })
}

# Scoped to this environment's path, so a dev dispatcher cannot read a prod key. The
# public key is deliberately absent: nothing on the server needs it.
resource "aws_iam_role_policy" "push_dispatch_ssm" {
  name = "${local.name}-ssm"
  role = aws_iam_role.push_dispatch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadVapidPrivateKey"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.vapid_private_key.arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# The schedule
#
# EventBridge Scheduler rather than a classic CloudWatch event rule, for one
# attribute: schedule_expression_timezone. Scheduler evaluates a named IANA zone
# and handles daylight saving itself, so 07:30 stays 07:30 across the BST
# transition, a nonexistent spring-forward time is skipped, and a repeated
# autumn one fires once. A UTC cron would be an hour out for half the year, and
# the alternative fix - sweeping every 30 minutes and matching a client-written
# slot - is 48 invocations a day to correct one hour twice a year.
#
# The trade is that the times are Terraform variables and changing them needs an
# apply. For one person setting them once, that is the right side of it.
# -----------------------------------------------------------------------------
resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
        # Scheduler assumes this role for any schedule in the account, so the account
        # condition is what keeps a schedule someone else owns from borrowing it.
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "${local.name}-scheduler-invoke"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeDispatcher"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.push_dispatch.arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "send" {
  for_each = var.send_windows

  name        = "${local.name}-${each.key}"
  description = "Fires the ${each.key} digest window."

  # OFF, not a window: the times are the product. A digest that turns up at 08:15
  # because the service felt like spreading load is a different notification.
  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = each.value
  schedule_expression_timezone = "Europe/London"

  target {
    arn      = aws_lambda_function.push_dispatch.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ slot = each.key })

    # A retry would send the digest twice, and the same counts arriving again is worse
    # than one missed window with the next one twelve hours away.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
