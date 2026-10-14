# web-hosting

S3 plus CloudFront for the built Lifeboard app.

```
Browser ──► CloudFront ──(OAC, SigV4)──► S3  lifeboard-app-{env}
```

The bucket is private and only this distribution can read it. 403 and 404 both
map to `/index.html` with a 200 so client-side routes resolve. The default cache
behaviour is no-cache and only `var.immutable_path_patterns` gets a one-year
immutable cache, because Vite content-hashes everything under `dist/assets/` and
nothing else is safe to pin. Response headers policies set `Cache-Control` on the
way out, since the cache policy governs the edge and the header governs the
browser.

The custom domain is optional: with `aliases` empty and `acm_certificate_arn`
null, CloudFront serves its own `*.cloudfront.net` certificate.

Rationale in [`../../README.md`](../../README.md).

## Inputs

| Name | Description | Type | Default |
|------|-------------|------|---------|
| `environment` | Deployment environment (dev/prod) | `string` | n/a |
| `project` | Name prefix for resources | `string` | `lifeboard` |
| `bucket_suffix` | Suffix for global bucket-name uniqueness | `string` | `""` |
| `price_class` | CloudFront price class | `string` | `PriceClass_100` |
| `immutable_path_patterns` | Patterns cached for a year | `list(string)` | `["/assets/*"]` |
| `acm_certificate_arn` | us-east-1 certificate ARN, or null | `string` | `null` |
| `aliases` | Custom domain names | `list(string)` | `[]` |
| `log_bucket_domain` | Access log bucket domain, or null | `string` | `null` |
| `log_prefix` | Access log key prefix | `string` | `""` |

## Outputs

| Name | Description |
|------|-------------|
| `cloudfront_domain` | Distribution domain name |
| `cloudfront_distribution_id` | For cache invalidation |
| `cloudfront_distribution_arn` | Distribution ARN |
| `cloudfront_distribution_hosted_zone_id` | Alias target zone for Route 53 |
| `app_bucket_name` | Bucket to sync `dist/` to |
| `app_bucket_arn` | Bucket ARN |
| `site_url` | Canonical origin: first alias, else the CloudFront domain |
