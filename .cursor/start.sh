#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"

if curl -sf "http://${HOST}:${PORT}" >/dev/null 2>&1; then
  echo "Dev server already responding on ${HOST}:${PORT}"
  exit 0
fi

exec npm run dev -- --hostname "$HOST" --port "$PORT"
