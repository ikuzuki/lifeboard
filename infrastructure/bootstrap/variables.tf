variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be dev or prod."
  }
}

variable "notification_email" {
  description = "Email address for budget and alarm notifications"
  type        = string
}

variable "enable_github_oidc" {
  description = "Create the GitHub Actions OIDC provider and deploy role. Off by default: Lifeboard has no CI pipeline yet and the role carries broad permissions, so it should not exist until something uses it."
  type        = bool
  default     = false
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC provider rather than reusing the one already in the account. There can only be one per URL per account, so leave this false wherever another project already created it, which is the case in the personal account shared with fpl-platform."
  type        = bool
  default     = false
}

variable "github_repo" {
  description = "GitHub repository in the format owner/repo. Only read when enable_github_oidc is true."
  type        = string
  default     = "ikuzuki/lifeboard"
}

variable "monthly_budget_limit_usd" {
  description = "Forecast/actual alert threshold for the monthly cost budget, in USD."
  type        = string
  default     = "5"
}
