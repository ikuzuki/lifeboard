# -----------------------------------------------------------------------------
# Capture parser: one Lambda holding the Anthropic API key, behind an HTTP API
# with a Cognito JWT authorizer.
#
# Why an HTTP API rather than a Function URL. A Function URL's authorization_type
# is AWS_IAM or NONE and nothing else; there is no Cognito authorizer for one. The
# alternatives were SigV4 from the browser using the identity pool's temporary
# credentials, which means shipping a signing SDK and a second auth path, or a
# shared-secret header, which is not user authentication at all. An HTTP API JWT
# authorizer validates the Cognito token at the edge, before the Lambda runs and
# before anything is billed, and the client already holds the token.
#
# The authorizer checks the ID token, not the access token: `aud` carries the app
# client ID on an ID token, and jwt_configuration.audience is matched against it.
# -----------------------------------------------------------------------------

data "aws_region" "current" {}

locals {
  name = "${var.project}-${var.environment}-capture"
}

# -----------------------------------------------------------------------------
# The key. A SecureString shell, populated by hand in the Console after the first
# apply; lifecycle.ignore_changes means later applies leave the real value alone.
# Encrypted with the default alias/aws/ssm key, which is free and needs no
# kms:Decrypt grant of its own: that key policy allows Decrypt for in-account
# principals calling via SSM, which is exactly this read path. A customer-managed
# key would need an explicit kms:Decrypt statement below.
#
# With the parameter left at its placeholder the Lambda still runs and still
# returns 502, and the client degrades to putting the raw text in a title.
# -----------------------------------------------------------------------------
resource "aws_ssm_parameter" "anthropic_api_key" {
  name        = "${var.secret_prefix}/${var.environment}/anthropic-api-key"
  description = "Anthropic API key for brain dump parsing. Read at Lambda cold start."
  type        = "SecureString"
  value       = "REPLACE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

# -----------------------------------------------------------------------------
# Lambda
# -----------------------------------------------------------------------------
data "archive_file" "capture" {
  type        = "zip"
  source_dir  = "${var.source_dir}/build"
  output_path = "${var.source_dir}/handler.zip"
}

resource "aws_lambda_function" "capture" {
  function_name    = local.name
  description      = "Parses a brain dump into draft items with one Claude Haiku call."
  role             = aws_iam_role.capture.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  memory_size      = var.memory_size
  filename         = data.archive_file.capture.output_path
  source_code_hash = data.archive_file.capture.output_base64sha256

  # A cap on spend as much as on concurrency. One person dictating cannot need more
  # than a couple in flight, and a runaway client cannot run up a model bill.
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      ENV                    = var.environment
      MODEL                  = var.model
      SECRET_PREFIX          = var.secret_prefix
      USAGE_TABLE            = aws_dynamodb_table.usage.name
      MONTHLY_LIMIT_USD      = tostring(var.monthly_limit_usd)
      USER_MONTHLY_LIMIT_USD = tostring(var.user_monthly_limit_usd)
    }
  }
}

resource "aws_cloudwatch_log_group" "capture" {
  name              = "/aws/lambda/${aws_lambda_function.capture.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "capture" {
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

resource "aws_iam_role_policy_attachment" "capture_basic" {
  role       = aws_iam_role.capture.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Scoped to this environment's parameter path, so a dev Lambda cannot read a prod key.
resource "aws_iam_role_policy" "capture_ssm" {
  name = "${local.name}-ssm"
  role = aws_iam_role.capture.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadApiKey"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.anthropic_api_key.arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Monthly spend cap
#
# The Anthropic bill is the only usage-scaling cost in this app, and the AWS Budgets in
# bootstrap can only see AWS spend. One row per calendar month, lazy-created, so a new
# month needs no deploy. Mirrors fpl-agent-usage in fpl-platform.
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "usage" {
  name         = "${local.name}-usage"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "month"

  attribute {
    name = "month"
    type = "S"
  }
}

resource "aws_iam_role_policy" "capture_usage" {
  name = "${local.name}-usage"
  role = aws_iam_role.capture.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "MeterSpend"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.usage.arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# HTTP API
# -----------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "capture" {
  name          = local.name
  description   = "Brain dump parsing for Lifeboard."
  protocol_type = "HTTP"

  # CORS lives here rather than in the handler so there is one place for it to be
  # wrong. The authorizer answers preflight itself, so OPTIONS never reaches Lambda.
  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.capture.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.name}-cognito"

  jwt_configuration {
    audience = [var.user_pool_client_id]
    issuer   = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${var.user_pool_id}"
  }
}

resource "aws_apigatewayv2_integration" "capture" {
  api_id                 = aws_apigatewayv2_api.capture.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.capture.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "capture" {
  api_id             = aws_apigatewayv2_api.capture.id
  route_key          = "POST /capture"
  target             = "integrations/${aws_apigatewayv2_integration.capture.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# One route only, and no $default. An unmatched path is a 404 at the edge rather
# than an unauthenticated invocation of something.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.capture.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId       = "$context.requestId"
      httpMethod      = "$context.httpMethod"
      routeKey        = "$context.routeKey"
      status          = "$context.status"
      responseLength  = "$context.responseLength"
      errorMessage    = "$context.error.message"
      authorizerError = "$context.authorizer.error"
    })
  }

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHTTPAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.capture.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.capture.execution_arn}/*/*"
}
