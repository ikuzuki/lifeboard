locals {
  bucket_name = "${var.project}-user-data-${var.environment}${var.bucket_suffix == "" ? "" : "-${var.bucket_suffix}"}"

  # The IAM policy variable, written so Terraform leaves it alone.
  #
  # $${...} escapes to a literal ${...} in the rendered policy. That literal is
  # what IAM substitutes at request time with the caller's Cognito identity ID
  # (shaped "eu-west-2:0000aaaa-bbbb-cccc-dddd-111122223333"). If this were
  # written with a single $, Terraform would try to resolve it as an
  # interpolation at plan time and fail; worse, any construction that resolved
  # to a constant would grant every user the same prefix. Colons are legal in
  # S3 keys, so the identity ID drops straight into the key path.
  own_prefix = "users/$${cognito-identity.amazonaws.com:sub}/*"
}

# -----------------------------------------------------------------------------
# S3 bucket: one state document per user, under users/{identity-id}/
#
# Versioning is on so a bad write is recoverable: the client does a
# read-modify-write of a whole document, so a truncated or malformed put would
# otherwise be unrecoverable. Noncurrent versions expire on a lifecycle rule
# rather than accumulating forever.
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "user_data" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_versioning" "user_data" {
  bucket = aws_s3_bucket.user_data.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "user_data" {
  bucket = aws_s3_bucket.user_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "user_data" {
  bucket = aws_s3_bucket.user_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "user_data" {
  bucket = aws_s3_bucket.user_data.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = var.abort_incomplete_multipart_days
    }
  }

  # Versioning turns a delete into a delete marker. Once every version beneath
  # a marker has expired, the marker itself is litter, so clear it.
  rule {
    id     = "expire-orphaned-delete-markers"
    status = "Enabled"

    filter {}

    expiration {
      expired_object_delete_marker = true
    }
  }
}

# -----------------------------------------------------------------------------
# CORS
#
# The browser talks to S3 directly here, signing requests with the temporary
# credentials from the identity pool, so this is not fronted by CloudFront and
# the bucket's own CORS rules are what the browser enforces.
#
# ETag has to be exposed explicitly. It is not one of the CORS-safelisted
# response headers, so without expose_headers the client can read the body but
# not the ETag, and the conditional write (If-Match on PUT, If-None-Match for
# create-if-absent) has nothing to send. That would silently degrade the write
# path into last-writer-wins.
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_cors_configuration" "user_data" {
  bucket = aws_s3_bucket.user_data.id

  cors_rule {
    id              = "app-origins"
    allowed_origins = var.cors_allowed_origins
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = var.cors_max_age_seconds
  }
}

# -----------------------------------------------------------------------------
# Authenticated role: the whole security model
#
# Two independent gates, both of which must hold:
#
# 1. Trust policy. Only the Cognito identity broker may assume this role, only
#    via AssumeRoleWithWebIdentity, only for identities issued by this identity
#    pool (the :aud condition), and only where the authentication method was
#    "authenticated" rather than "unauthenticated" (the :amr condition).
#    Without the :aud pin, an identity from any other identity pool in any AWS
#    account could assume it, so that condition is not optional decoration.
#
# 2. Permissions policy. The role can only touch keys under
#    users/${cognito-identity.amazonaws.com:sub}/. IAM substitutes that
#    variable per request from the assumed identity, so the credentials handed
#    to user A are literally incapable of naming user B's prefix: it is not a
#    check the client performs and cannot be bypassed by crafting a key.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "authenticated_assume" {
  statement {
    sid     = "CognitoIdentityPoolAuthenticated"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = ["cognito-identity.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "cognito-identity.amazonaws.com:aud"
      values   = [var.identity_pool_id]
    }

    condition {
      test     = "ForAnyValue:StringLike"
      variable = "cognito-identity.amazonaws.com:amr"
      values   = ["authenticated"]
    }
  }
}

resource "aws_iam_role" "authenticated" {
  name               = "${var.project}-${var.environment}-authenticated"
  description        = "Assumed by authenticated Lifeboard users via the Cognito identity pool. Grants object read and write within the caller's own prefix only."
  assume_role_policy = data.aws_iam_policy_document.authenticated_assume.json
}

# Deliberately narrow, and worth stating what is absent as well as present:
#
#   s3:GetObject, s3:PutObject   the read-modify-write cycle the client needs
#   s3:DeleteObject              omitted. The app soft-deletes inside the
#                                document, so nothing needs to remove a key,
#                                and withholding it means a compromised token
#                                cannot destroy the user's own data either.
#   s3:ListBucket                omitted. It is a bucket-level action, so it
#                                cannot be scoped by object key: granting it
#                                would need a separate statement on the bucket
#                                ARN with an s3:prefix condition. The client
#                                knows its own key, so it never needs to
#                                enumerate. Adding it later is the one change
#                                that could widen this policy by accident.
#   Resource with a wildcard user segment  never. The only path component
#                                between users/ and the object is the IAM
#                                policy variable.
resource "aws_iam_role_policy" "authenticated_own_prefix" {
  name = "${var.project}-${var.environment}-own-prefix-only"
  role = aws_iam_role.authenticated.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadWriteOwnPrefixOnly"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
        ]
        Resource = "${aws_s3_bucket.user_data.arn}/${local.own_prefix}"
      }
    ]
  })
}
