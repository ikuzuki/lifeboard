terraform {
  backend "s3" {
    bucket         = "lifeboard-dev-tf-state"
    key            = "dev/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "lifeboard-dev-tf-lock-table"
    encrypt        = true
  }
}

provider "aws" {
  region = "eu-west-2"

  default_tags {
    tags = local.common_tags
  }
}

# CloudFront only reads certificates from us-east-1, so the ACM resources in
# domain.tf use this alias while everything else stays in London.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.common_tags
  }
}
