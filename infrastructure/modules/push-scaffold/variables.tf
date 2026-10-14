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

variable "source_dir" {
  description = "Directory holding the dispatcher. Its build/ subdirectory is archived as found, so build.sh must have run. Relative to the calling root module."
  type        = string
}

variable "secret_prefix" {
  description = "Parameter Store path prefix for the VAPID pair. Full names are {prefix}/{environment}/vapid-{private,public}-key."
  type        = string
  default     = "/lifeboard"
}

variable "send_windows" {
  description = "One schedule per send window, keyed by the slot passed to the handler. Cron is evaluated in Europe/London, so these are wall-clock times all year."
  type        = map(string)
  default = {
    morning = "cron(30 7 * * ? *)"
    evening = "cron(30 20 * * ? *)"
  }

  validation {
    # The handler knows two windows and refuses anything else, so a typo here should
    # fail at plan rather than twice a day in CloudWatch.
    condition     = length(setsubtract(keys(var.send_windows), ["morning", "evening"])) == 0
    error_message = "Send window keys must be morning and evening."
  }
}

variable "user_data_bucket_arn" {
  description = "ARN of the per-user state bucket. Read access is scoped to users/*/digest.json and users/*/push/* within it, so the dispatcher cannot name a state document."
  type        = string
}

variable "user_data_bucket_name" {
  description = "Name of the per-user state bucket, for the dispatcher's own S3 calls."
  type        = string
}

variable "vapid_subject" {
  description = "VAPID `sub` claim: who to contact about this application server. A push service rejects a token without one. The app's own URL is the least surprising value; a mailto: works too."
  type        = string

  validation {
    condition     = startswith(var.vapid_subject, "mailto:") || startswith(var.vapid_subject, "https://")
    error_message = "vapid_subject must be a mailto: address or an https:// URL."
  }
}

variable "memory_size" {
  description = "Dispatcher memory. The work is a handful of HTTPS calls rather than anything compute-bound; this is sized for a shorter cold start, not for throughput."
  type        = number
  default     = 256
}

variable "timeout" {
  description = "Dispatcher timeout in seconds. One window is a list, a couple of small reads and one send per device."
  type        = number
  default     = 60
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the dispatcher."
  type        = number
  default     = 30
}
