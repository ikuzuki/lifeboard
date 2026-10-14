locals {
  common_tags = {
    Repository  = "lifeboard"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "lifeboard"
  }
}
