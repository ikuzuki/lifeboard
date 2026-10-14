locals {
  bucket_name = "${var.project}-app-${var.environment}${var.bucket_suffix == "" ? "" : "-${var.bucket_suffix}"}"
}

# -----------------------------------------------------------------------------
# S3 bucket: Vite build output (dist/). Private; CloudFront reads it via OAC.
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "app" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket = aws_s3_bucket.app.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# -----------------------------------------------------------------------------
# CloudFront Origin Access Control
# OAC replaces the legacy OAI. CloudFront signs its origin requests with
# SigV4, so the bucket stays private and only this distribution can read it.
# -----------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "app" {
  name                              = "${var.project}-app-${var.environment}"
  description                       = "OAC for the Lifeboard app bucket (${local.bucket_name})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -----------------------------------------------------------------------------
# Response headers policies
#
# The cache policies below control the CloudFront edge cache. They do not
# control the browser cache, which is what actually decides whether a returning
# user sees a stale index.html or an old service worker. These policies set
# Cache-Control on the response with override = true, so the browser is told
# the same story as the edge regardless of what metadata the upload carried.
# -----------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "revalidate" {
  name    = "${var.project}-${var.environment}-revalidate"
  comment = "no-cache for index.html, the service worker and SPA routes"

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "no-cache, must-revalidate"
      override = true
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "immutable" {
  name    = "${var.project}-${var.environment}-immutable"
  comment = "one-year immutable cache for content-hashed build assets"

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=31536000, immutable"
      override = true
    }
  }
}

# -----------------------------------------------------------------------------
# CloudFront distribution
#
# Cache split, deliberately the opposite way round to the usual default:
#
#   default behaviour        no-cache, revalidate every request
#   var.immutable_path_patterns   one year, immutable
#
# Vite emits content-hashed filenames into dist/assets/, so those keys change
# on every build and can be cached forever. Everything else (index.html, the
# service worker, the web manifest, and every client-side route that resolves
# to index.html through the 403/404 mapping below) must not be cached, or a
# deploy is invisible until the TTL lapses. Making the *default* the safe side
# means a new unhashed file added later is stale-proof by default rather than
# silently pinned for a day.
#
# Note that default_root_object only rewrites the origin request for "/". The
# cache behaviour is still matched against the viewer path "/", which is why
# an ordered behaviour on "/index.html" would not have covered the home page.
# -----------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = var.price_class
  comment             = "Lifeboard ${var.environment}"
  aliases             = var.aliases

  origin {
    origin_id                = "app"
    domain_name              = aws_s3_bucket.app.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id
  }

  # --- Hashed build assets: cache hard, never invalidate ---
  dynamic "ordered_cache_behavior" {
    for_each = toset(var.immutable_path_patterns)

    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = "app"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      # AWS managed: CachingOptimized (1 day default, 1 year max TTL)
      cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
      response_headers_policy_id = aws_cloudfront_response_headers_policy.immutable.id
    }
  }

  # --- Everything else: index.html, sw.js, manifest, SPA routes ---
  default_cache_behavior {
    target_origin_id       = "app"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed: CachingDisabled
    cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.revalidate.id
  }

  # SPA routing: S3 answers 404 for a key that does not exist and 403 for a
  # key the OAC policy does not cover, and a client-side route such as /goals
  # is neither. Both map to index.html with a 200 so the router can take over.
  # error_caching_min_ttl = 0 keeps a genuine missing asset from being pinned.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  dynamic "logging_config" {
    for_each = var.log_bucket_domain == null ? [] : [1]

    content {
      bucket          = var.log_bucket_domain
      prefix          = var.log_prefix
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Falls back to the default *.cloudfront.net certificate until a custom
  # domain and its us-east-1 certificate exist.
  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == null
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = var.acm_certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.acm_certificate_arn == null ? null : "TLSv1.2_2021"
  }
}

# -----------------------------------------------------------------------------
# S3 bucket policy: grants this distribution, and only this distribution,
# read access to the app bucket.
# -----------------------------------------------------------------------------
resource "aws_s3_bucket_policy" "app" {
  bucket = aws_s3_bucket.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.app.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.app.arn
          }
        }
      }
    ]
  })
}
