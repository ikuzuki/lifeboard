#!/usr/bin/env bash
# Builds the deployment package for the capture parser.
#
# Terraform archives build/ as-is, so this must run before plan or apply, and again
# after any change to handler.py or requirements.txt. Kept as a script rather than a
# null_resource so a failed dependency install is visible rather than buried in a
# Terraform log.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build="${here}/build"

rm -rf "${build}"
mkdir -p "${build}"

# --only-binary keeps a source build from producing wheels for the local platform.
# --index-url pins PyPI explicitly. A globally configured private index is otherwise used,
# which fails without a live token and would also point a personal project at work
# infrastructure.
python -m pip install \
  --index-url https://pypi.org/simple \
  --requirement "${here}/requirements.txt" \
  --target "${build}" \
  --platform manylinux2014_x86_64 \
  --python-version 3.12 \
  --only-binary :all: \
  --upgrade

# Every first-party module the handler imports, not just the entry point. `budget.py` is
# imported by handler.py, so omitting it fails at cold start with ModuleNotFoundError
# rather than at build time.
for mod in handler.py budget.py; do
  cp "${here}/${mod}" "${build}/${mod}"
done

# Tests and dist-info are dead weight in a package that pays for its own cold start.
find "${build}" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "${build}" -type d -name 'tests' -prune -exec rm -rf {} +

echo "built ${build}"
