variable "environment" {
  description = "Deployment environment (dev/prod). Selects the SSM parameter path, so a dev Lambda can never read a prod key."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be dev or prod."
  }
}

variable "project" {
  description = "Name prefix for every resource in this module."
  type        = string
  default     = "lifeboard"
}

variable "source_dir" {
  description = "Directory holding the Lambda source and its build/ output, relative to the calling root. Run build.sh in it before plan or apply: Terraform archives build/ as it finds it."
  type        = string
}

variable "user_pool_id" {
  description = "Cognito user pool ID. Forms the JWT authorizer's issuer URL."
  type        = string
}

variable "user_pool_client_id" {
  description = "Cognito app client ID. Matched against the aud claim, which means the client must send the ID token rather than the access token."
  type        = string
}

variable "allowed_origins" {
  description = "Origins allowed to call the API. The CloudFront domain and the Vite dev server, not a wildcard: a wildcard with an Authorization header is a browser-enforced error anyway."
  type        = list(string)
}

variable "model" {
  description = "Claude model id. Haiku 4.5 is the right tier for structured extraction from a short dump."
  type        = string
  default     = "claude-haiku-4-5"
}

variable "secret_prefix" {
  description = "SSM Parameter Store path prefix. The full name is {prefix}/{environment}/anthropic-api-key."
  type        = string
  default     = "/lifeboard"
}

variable "memory_size" {
  description = "Lambda memory in MB. 512 rather than 128 because Lambda scales CPU with memory and the cold start is dominated by importing the Anthropic SDK, not by the request itself."
  type        = number
  default     = 512
}

variable "reserved_concurrency" {
  description = "Cap on parallel invocations. A spend backstop as much as a concurrency one: one person dictating cannot need more, and a looping client cannot run up a model bill. Set to -1 to use the account pool."
  type        = number
  default     = 2
}

variable "throttling_rate_limit" {
  description = "Steady-state requests per second at the API stage. Second line of defence behind reserved concurrency."
  type        = number
  default     = 5
}

variable "throttling_burst_limit" {
  description = "Burst capacity at the API stage."
  type        = number
  default     = 10
}

variable "log_retention_days" {
  description = "CloudWatch retention for the Lambda and API access logs."
  type        = number
  default     = 30
}

variable "monthly_limit_usd" {
  description = "Global monthly Anthropic spend cap in USD, across all users. Checked before every model call; over it, capture returns 429 and the client degrades to putting the raw text in one draft. At roughly 0.2p a capture the default is far above any plausible personal use, and exists to catch a loop rather than to ration."
  type        = number
  default     = 5
}

variable "user_monthly_limit_usd" {
  description = "Per-user monthly cap in USD, enforced alongside the global one. A global cap alone lets the first account to run a loop take the lot, which is the failure this prevents."
  type        = number
  default     = 2
}
