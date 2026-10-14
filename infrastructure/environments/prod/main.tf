# -----------------------------------------------------------------------------
# Prod environment: Terraform stub. NOT APPLIED.
#
# Lifeboard runs dev-only on a personal account. This directory declares the
# prod root so the dev/prod difference stays a provisioning question rather
# than a code-structure one: every module under ../../modules/ is
# parameterised on var.environment and namespaces its AWS resources on it.
#
# To go live:
#   1. Create the state bucket and lock table named in the backend block
#      (lifeboard-prod-tf-state, lifeboard-prod-tf-lock-table) by running the
#      bootstrap root with environment = "prod".
#   2. Copy the service-level .tf files from ../dev/ (web.tf, domain.tf,
#      auth.tf, user-data.tf, push.tf, outputs.tf) and ../dev/variables.tf
#      into this directory.
#   3. Register a second Google OAuth client for the prod hosted UI domain.
#      Reusing the dev client would mean one credential covering both.
#   4. Copy terraform.tfvars.example to terraform.tfvars, fill it in, and
#      export the Google secrets as TF_VAR_ values.
#   5. terraform init && terraform plan.
#
# See README.md for context.
# -----------------------------------------------------------------------------
terraform {
  backend "s3" {
    bucket         = "lifeboard-prod-tf-state"
    key            = "prod/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "lifeboard-prod-tf-lock-table"
    encrypt        = true
  }
}

provider "aws" {
  region = "eu-west-2"

  default_tags {
    tags = local.common_tags
  }
}
