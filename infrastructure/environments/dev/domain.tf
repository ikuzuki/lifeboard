# -----------------------------------------------------------------------------
# Custom domain, entirely optional, gated on var.domain_name
#
# Every resource here counts to zero when domain_name is null, which is the
# state on a fresh account: no registered domain, no hosted zone, no
# certificate. Set domain_name and route53_zone_name once the zone exists and
# the same apply issues the certificate, publishes the validation records and
# attaches the alias to CloudFront.
#
# The hosted zone is looked up by name rather than created, because the zone is
# usually shared with other subdomains and owned elsewhere.
# -----------------------------------------------------------------------------
data "aws_route53_zone" "primary" {
  count = var.domain_name == null ? 0 : 1

  name = var.route53_zone_name
}

resource "aws_acm_certificate" "app" {
  count    = var.domain_name == null ? 0 : 1
  provider = aws.us_east_1

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ACM publishes a CNAME challenge, Terraform writes it into the zone, ACM
# checks it, the certificate flips to ISSUED.
resource "aws_route53_record" "app_cert_validation" {
  for_each = var.domain_name == null ? {} : {
    for dvo in aws_acm_certificate.app[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.primary[0].zone_id
}

# Blocks until ACM reports the certificate ISSUED. web.tf reads
# certificate_arn from here, so CloudFront never attempts an unvalidated cert.
resource "aws_acm_certificate_validation" "app" {
  count    = var.domain_name == null ? 0 : 1
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = [for record in aws_route53_record.app_cert_validation : record.fqdn]
}

resource "aws_route53_record" "app_a" {
  count = var.domain_name == null ? 0 : 1

  zone_id = data.aws_route53_zone.primary[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.web_hosting.cloudfront_domain
    zone_id                = module.web_hosting.cloudfront_distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_aaaa" {
  count = var.domain_name == null ? 0 : 1

  zone_id = data.aws_route53_zone.primary[0].zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = module.web_hosting.cloudfront_domain
    zone_id                = module.web_hosting.cloudfront_distribution_hosted_zone_id
    evaluate_target_health = false
  }
}
