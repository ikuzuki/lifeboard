variable "project" {
  description = "Project name for resource naming"
  type        = string
  default     = "lifeboard"
}

variable "environment" {
  description = "Deployment environment (dev/prod)"
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be dev or prod."
  }
}

variable "bucket_suffix" {
  description = "Optional suffix appended to the bucket name. S3 bucket names are globally unique, so set this to something account-specific if {project}-app-{environment} is already taken."
  type        = string
  default     = ""
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 covers US/Europe (cheapest). PriceClass_All adds Asia/Pacific."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200, or PriceClass_All."
  }
}

variable "immutable_path_patterns" {
  description = "Path patterns served with a one-year immutable cache. Vite writes content-hashed filenames into dist/assets/, so a new build produces new keys and never needs an invalidation. Everything outside these patterns (index.html, the service worker, the manifest, SPA routes) is revalidated on every request."
  type        = list(string)
  default     = ["/assets/*"]
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate in us-east-1 covering the names in var.aliases. Null makes CloudFront serve its default *.cloudfront.net certificate, which is the supported state until a domain and certificate exist."
  type        = string
  default     = null
}

variable "aliases" {
  description = "Custom domain names (CNAMEs) the distribution answers on. Each must be covered by acm_certificate_arn. Empty list disables custom-domain wiring."
  type        = list(string)
  default     = []
}

variable "log_bucket_domain" {
  description = "Bucket domain for CloudFront standard access logs (e.g. ikuzuki-analytics-logs.s3.eu-west-2.amazonaws.com). Null disables logging."
  type        = string
  default     = null
}

variable "log_prefix" {
  description = "Key prefix for delivered access logs within the log bucket (e.g. cloudfront/lifeboard/)."
  type        = string
  default     = ""
}
