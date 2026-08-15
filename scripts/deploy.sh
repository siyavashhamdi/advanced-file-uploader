#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  echo "Usage: npm run deploy"
  echo
  echo "Builds TypeScript into a staging dir, promotes to dist/, then restarts PM2."
  echo "Environment is read from .env (APP_ENV, NODE_ENV, PORT) when present."
  echo "  APP_ENV=production  -> PM2 advanced-file-uploader"
  echo "  APP_ENV=staging     -> PM2 staging-advanced-file-uploader"
  exit 1
}

read_env_var() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return 0
  fi
  local value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

case "${1:-}" in
  -h|--help|help) usage ;;
  "") ;;
  *)
    echo "Unknown argument: ${1}"
    usage
    ;;
esac

STAGING_DIR="dist.next"
BUILD_HEAP_MB="${BUILD_HEAP_MB:-512}"

if [[ ! -f .env ]]; then
  echo "Missing .env (deploy does not create it). Create it once from .env.example."
  exit 1
fi

APP_ENV="$(read_env_var .env APP_ENV)"
APP_ENV="$(echo "${APP_ENV:-production}" | tr '[:upper:]' '[:lower:]')"
NODE_ENV_VALUE="$(read_env_var .env NODE_ENV)"
NODE_ENV_VALUE="${NODE_ENV_VALUE:-production}"
PORT="$(read_env_var .env PORT)"
PORT="${PORT:-3000}"

case "$APP_ENV" in
  production|staging|development) ;;
  *)
    echo "Unsupported APP_ENV='${APP_ENV}' in .env (use production|staging|development)."
    exit 1
    ;;
esac

if [[ "$APP_ENV" == "staging" ]]; then
  PM2_NAME="staging-advanced-file-uploader"
else
  PM2_NAME="advanced-file-uploader"
fi

promote_staging_build() {
  local staging="${STAGING_DIR}"
  local live="dist"

  if [[ ! -f "${staging}/server.js" ]]; then
    echo "Build verification failed: ${staging}/server.js is missing."
    exit 1
  fi

  rm -rf "${live}.old"
  if [[ -d "$live" ]]; then
    mv "$live" "${live}.old"
  fi

  mv "$staging" "$live"
  rm -rf "${live}.old"
  echo "Promoted ${staging} -> ${live}"
}

restart_pm2() {
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "PM2 is not installed. Install it globally with: npm install -g pm2"
    exit 1
  fi

  echo "Restarting PM2 process for APP_ENV=${APP_ENV} (${PM2_NAME})..."
  pm2 restart "$PM2_NAME" 2>/dev/null || pm2 start ecosystem.config.cjs --only "$PM2_NAME"
  pm2 save
}

echo "Deploy APP_ENV=${APP_ENV} NODE_ENV=${NODE_ENV_VALUE} port=${PORT}"

echo "Installing dependencies..."
npm ci

mkdir -p logs

echo "Building into staging directory (heap limit: ${BUILD_HEAP_MB}MB)..."
rm -rf "${STAGING_DIR}"
export NODE_OPTIONS="--max-old-space-size=${BUILD_HEAP_MB}"
npx tsc --outDir "${STAGING_DIR}"
unset NODE_OPTIONS
promote_staging_build

# Production runtime deps only after a successful promote
npm prune --omit=dev

restart_pm2

echo
echo "Deployment complete (APP_ENV=${APP_ENV})."
echo "App: http://0.0.0.0:${PORT}"
echo
echo "Useful commands:"
echo "  pm2 status"
echo "  pm2 logs ${PM2_NAME}"
echo "  npm run stop"
echo "  npm run deploy"
