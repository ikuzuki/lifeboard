# -----------------------------------------------------------------------------
# Static hosting: S3 plus CloudFront for the built app
#
# The custom domain is optional. With var.domain_name null the module gets an
# empty alias list and a null certificate ARN, and CloudFront serves its own
# *.cloudfront.net name, so this applies cleanly on an account with no hosted
# zone and no certificate.
# -----------------------------------------------------------------------------
module "web_hosting" {
  source = "../../modules/web-hosting"

  environment   = var.environment
  bucket_suffix = var.bucket_suffix

  aliases             = var.domain_name == null ? [] : [var.domain_name]
  acm_certificate_arn = var.domain_name == null ? null : aws_acm_certificate_validation.app[0].certificate_arn
}
