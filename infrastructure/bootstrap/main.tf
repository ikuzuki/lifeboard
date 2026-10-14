provider "aws" {
  region = "eu-west-2"

  default_tags {
    tags = local.common_tags
  }
}

# --- S3 State Bucket ---
resource "aws_s3_bucket" "tf_state" {
  bucket = "lifeboard-${var.environment}-tf-state"
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- DynamoDB Lock Table ---
resource "aws_dynamodb_table" "tf_lock" {
  name         = "lifeboard-${var.environment}-tf-lock-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# --- GitHub OIDC Provider ---
#
# One per URL per AWS account, so in an account already running another project's
# pipeline this is shared infrastructure that something else owns. Creating a second
# fails with EntityAlreadyExists, and importing it would let a `terraform destroy` here
# delete the provider out from under the other project. So: look it up when it exists,
# create it only on an account that has none.
data "aws_iam_openid_connect_provider" "github" {
  count = var.enable_github_oidc && !var.create_github_oidc_provider ? 1 : 0

  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.enable_github_oidc && var.create_github_oidc_provider ? 1 : 0

  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  repo_owner = split("/", var.github_repo)[0]
  repo_name  = split("/", var.github_repo)[1]

  github_oidc_provider_arn = var.create_github_oidc_provider ? one(aws_iam_openid_connect_provider.github[*].arn) : one(data.aws_iam_openid_connect_provider.github[*].arn)
}

# --- CI/CD IAM Role ---
data "aws_iam_policy_document" "github_actions_assume" {
  count = var.enable_github_oidc ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    # Two patterns, because GitHub's default subject prefix differs by how old the repo is.
    # An older repo gets `repo:owner/name:...`; a newer one embeds immutable numeric ids and
    # reads `repo:owner@74075112/name@1336304818:...`. A pattern copied between two repos in
    # the same account therefore silently fails to match, which is what happened here. IAM
    # will not accept a trust policy for this provider that omits a `sub` condition, so
    # matching on the `repository` claim alone is not an option: it rejects the policy with
    # MalformedPolicyDocument.
    #
    # Both end in `:*`, so any ref may deploy, which is what the single pattern allowed
    # before. The `@*` wildcards cannot widen this to another repo, because a GitHub login
    # cannot contain an `@`.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:*",
        "repo:${local.repo_owner}@*/${local.repo_name}@*:*",
      ]
    }

    # Redundant against the patterns above and kept deliberately: this one states the repo
    # exactly, so a mistake in a wildcard cannot quietly admit a different repository.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository"
      values   = [var.github_repo]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cicd" {
  count = var.enable_github_oidc ? 1 : 0

  name               = "Lifeboard-${title(var.environment)}-CICD-Role"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume[0].json
}

# AdministratorAccess: acceptable for a personal dev account with OIDC-scoped
# trust. Production would use least-privilege policies per service.
resource "aws_iam_role_policy_attachment" "cicd_admin" {
  count = var.enable_github_oidc ? 1 : 0

  role       = aws_iam_role.cicd[0].name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# --- Budget Alerts ---
resource "aws_budgets_budget" "zero_spend" {
  name         = "lifeboard-zero-spend-alert"
  budget_type  = "COST"
  limit_amount = "1"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 1
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }
}

resource "aws_budgets_budget" "monthly_cap" {
  name         = "lifeboard-monthly-cap"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.notification_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }
}
