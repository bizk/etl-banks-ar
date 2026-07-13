#!/bin/bash

set -e

if [ -f ".env" ]; then
  set -a
  . ./.env
  set +a
fi

DEPLOY_HOST="${DEPLOY_HOST:-user@example-host}"
DEPLOY_BACKEND_REMOTE_PATH="${DEPLOY_BACKEND_REMOTE_PATH:-/srv/etl-banks-ar/api}"
DEPLOY_FRONTEND_REMOTE_PATH="${DEPLOY_FRONTEND_REMOTE_PATH:-/srv/etl-banks-ar/ui}"
DEPLOY_SERVICE_NAME="${DEPLOY_SERVICE_NAME:-etl-banks-ar-api}"
DEPLOY_FRONTEND_URL="${DEPLOY_FRONTEND_URL:-https://example-host}"
SKIP_BUILD=false

usage() {
  cat <<'EOF'
Usage:
  ./deploy.sh [options]

Options:
  --host <target>            SSH target, for example user@example-host
  --backend-path <path>      Remote path for the backend binary
  --frontend-path <path>     Remote path for frontend assets
  --service <name>           Remote systemd service name
  --frontend-url <url>       Public frontend URL shown after deploy
  --skip-build               Reuse existing build outputs
  --help                     Show this help

You can also set these values in a repo-root .env file:
  DEPLOY_HOST
  DEPLOY_BACKEND_REMOTE_PATH
  DEPLOY_FRONTEND_REMOTE_PATH
  DEPLOY_SERVICE_NAME
  DEPLOY_FRONTEND_URL
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      DEPLOY_HOST="$2"
      shift 2
      ;;
    --backend-path)
      DEPLOY_BACKEND_REMOTE_PATH="$2"
      shift 2
      ;;
    --frontend-path)
      DEPLOY_FRONTEND_REMOTE_PATH="$2"
      shift 2
      ;;
    --service)
      DEPLOY_SERVICE_NAME="$2"
      shift 2
      ;;
    --frontend-url)
      DEPLOY_FRONTEND_URL="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_value() {
  local label="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "Missing required value for ${label}" >&2
    exit 1
  fi
}

require_value "DEPLOY_HOST" "$DEPLOY_HOST"
require_value "DEPLOY_BACKEND_REMOTE_PATH" "$DEPLOY_BACKEND_REMOTE_PATH"
require_value "DEPLOY_FRONTEND_REMOTE_PATH" "$DEPLOY_FRONTEND_REMOTE_PATH"
require_value "DEPLOY_SERVICE_NAME" "$DEPLOY_SERVICE_NAME"

if [ "$SKIP_BUILD" = false ]; then
  (
    cd server
    make build-pi
  )
  (
    cd app
    npm run build
  )
fi

if [ ! -f "server/tostado" ]; then
  echo "Missing backend build output: server/tostado" >&2
  exit 1
fi

if [ ! -d "app/dist" ]; then
  echo "Missing frontend build output: app/dist" >&2
  exit 1
fi

ssh "$DEPLOY_HOST" "sudo systemctl stop $DEPLOY_SERVICE_NAME"
scp server/tostado "$DEPLOY_HOST:$DEPLOY_BACKEND_REMOTE_PATH"
rsync -avz --delete app/dist/ "$DEPLOY_HOST:$DEPLOY_FRONTEND_REMOTE_PATH"
ssh "$DEPLOY_HOST" "sudo systemctl start $DEPLOY_SERVICE_NAME"

echo "Deployment finished."
echo "Frontend: $DEPLOY_FRONTEND_URL"
