#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null; then
  echo "npm is required but not installed" >&2
  exit 1
fi

npm ci
