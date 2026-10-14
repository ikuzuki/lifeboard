output "cloudfront_domain" {
  description = "CloudFront distribution domain name (e.g. d1abc2def3.cloudfront.net)."
  value       = aws_cloudfront_distribution.app.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Used to run a cache invalidation after deploying a new build."
  value       = aws_cloudfront_distribution.app.id
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.app.arn
}

output "cloudfront_distribution_hosted_zone_id" {
  description = "CloudFront's Route 53 hosted zone ID (constant Z2FDTNDATAQYW2). Alias target zone for A/AAAA records pointing at the distribution."
  value       = aws_cloudfront_distribution.app.hosted_zone_id
}

output "app_bucket_name" {
  description = "Name of the S3 bucket holding the built app. Upload dist/ here after each build."
  value       = aws_s3_bucket.app.id
}

output "app_bucket_arn" {
  description = "ARN of the S3 app bucket."
  value       = aws_s3_bucket.app.arn
}

output "site_url" {
  description = "Canonical origin the app is served from: the first alias when a custom domain is configured, otherwise the CloudFront domain. Used to build Cognito callback URLs and the user-data bucket CORS allowlist."
  value       = length(var.aliases) > 0 ? "https://${var.aliases[0]}" : "https://${aws_cloudfront_distribution.app.domain_name}"
}
