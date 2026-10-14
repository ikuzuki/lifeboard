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
  description = "Optional suffix appended to the bucket name. S3 bucket names are globally unique, so set this to something account-specific if {project}-user-data-{environment} is already taken."
  type        = string
  default     = ""
}

variable "identity_pool_id" {
  description = "Cognito identity pool ID. Pinned in the role's trust policy as cognito-identity.amazonaws.com:aud so that only identities minted by this pool can assume the role."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Origins permitted to call the bucket directly from the browser. Must contain the deployed origin and the Vite dev server (http://localhost:5173). Wildcards are accepted by S3 but defeat the point."
  type        = list(string)
}

variable "cors_max_age_seconds" {
  description = "How long a browser may cache the CORS preflight response."
  type        = number
  default     = 3600
}

variable "noncurrent_version_expiration_days" {
  description = "How long a superseded object version is retained before deletion. This is the recovery window for a bad write, so it trades storage cost against how late a corruption can be noticed."
  type        = number
  default     = 30
}

variable "abort_incomplete_multipart_days" {
  description = "Days before an abandoned multipart upload is cleaned up. State documents are far too small to be multipart, so this only exists to stop orphaned parts accruing charges."
  type        = number
  default     = 7
}
