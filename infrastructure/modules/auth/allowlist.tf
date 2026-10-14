# -----------------------------------------------------------------------------
# Sign-in allowlist
#
# `allow_self_signup = false` blocks the native sign-up form but does not restrict which
# Google accounts may federate, so without this anyone with a Google account could sign in
# to a deployed Lifeboard. That makes it a cost control as much as an access control:
# every account that gets in can spend against the capture Lambda's monthly cap.
#
# The list is an SSM parameter rather than code, so changing it is one CLI call:
#
#   aws ssm put-parameter --name /lifeboard/dev/signin-allowlist \
#     --value "one@example.com,two@example.com" --overwrite
#
# Plain String, not SecureString: an allowlist of addresses is configuration, and putting
# it behind KMS would mean granting the Lambda kms:Decrypt for no real gain.
# -----------------------------------------------------------------------------
resource "aws_ssm_parameter" "allowlist" {
  name        = "${var.secret_prefix}/${var.environment}/signin-allowlist"
  description = "Comma-separated email addresses permitted to sign in."
  type        = "String"
  value       = var.initial_allowlist

  lifecycle {
    # Edits are expected to happen out of band, so Terraform must not drag the value
    # back to whatever was last committed.
    ignore_changes = [value]
  }
}

data "archive_file" "presignup" {
  type        = "zip"
  source_file = "${path.module}/../../lambdas/presignup_allowlist/handler.py"
  output_path = "${path.module}/../../lambdas/presignup_allowlist/handler.zip"
}

resource "aws_iam_role" "presignup" {
  name = "${var.project}-${var.environment}-presignup"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "presignup_basic" {
  role       = aws_iam_role.presignup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "presignup_ssm" {
  name = "${var.project}-${var.environment}-presignup-ssm"
  role = aws_iam_role.presignup.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadAllowlist"
      Effect   = "Allow"
      Action   = ["ssm:GetParameter"]
      Resource = aws_ssm_parameter.allowlist.arn
    }]
  })
}

resource "aws_lambda_function" "presignup" {
  function_name    = "${var.project}-${var.environment}-presignup"
  role             = aws_iam_role.presignup.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 5
  filename         = data.archive_file.presignup.output_path
  source_code_hash = data.archive_file.presignup.output_base64sha256

  environment {
    variables = {
      ALLOWLIST_PARAMETER = aws_ssm_parameter.allowlist.name
    }
  }
}

resource "aws_cloudwatch_log_group" "presignup" {
  name              = "/aws/lambda/${aws_lambda_function.presignup.function_name}"
  retention_in_days = 14
}

# Cognito invokes the trigger, so it needs its own permission. Scoped to this pool.
resource "aws_lambda_permission" "presignup" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presignup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
