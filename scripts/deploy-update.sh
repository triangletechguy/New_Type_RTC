#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/rtc-enterprise}"
BRANCH="${BRANCH:-main}"
DOMAIN_HOST="${DOMAIN_HOST:-funint.online}"
WEB_ROOT="${WEB_ROOT:-/var/www/rtc-enterprise}"
PM2_APP="${PM2_APP:-rtc-backend}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-2}"

log() {
  printf '\n==> %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $1" >&2
    exit 1
  fi
}

wait_for_url() {
  label="$1"
  url="$2"
  attempt=1

  while [ "$attempt" -le "$HEALTH_RETRIES" ]; do
    if response="$(curl -fsS "$url" 2>/tmp/deploy-update-curl-error)"; then
      printf '%s\n' "$response"
      return 0
    fi

    error_message="$(cat /tmp/deploy-update-curl-error 2>/dev/null || true)"
    printf 'Waiting for %s (%s/%s): %s\n' "$label" "$attempt" "$HEALTH_RETRIES" "${error_message:-not ready yet}" >&2
    attempt=$((attempt + 1))
    sleep "$HEALTH_DELAY_SECONDS"
  done

  echo "ERROR: $label did not become healthy: $url" >&2
  return 1
}

update_repo() {
  log "Updating repo"

  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git pull --ff-only origin "$BRANCH"
  git log -1 --oneline
}

install_dependencies() {
  log "Installing dependencies"

  npm --prefix backend install --omit=dev
  npm --prefix frontend install
}

build_frontend() {
  log "Building frontend"

  npm --prefix frontend run build
}

publish_frontend() {
  log "Publishing frontend to $WEB_ROOT"

  sudo mkdir -p "$WEB_ROOT"
  sudo rsync -a --delete frontend/dist/ "$WEB_ROOT/"
}

restart_backend() {
  log "Restarting backend from ecosystem config"

  if ! command -v pm2 >/dev/null 2>&1; then
    sudo npm install -g pm2
  fi

  pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --env production --update-env
  pm2 save
}

reload_web_server() {
  if systemctl is-active --quiet caddy 2>/dev/null; then
    log "Reloading Caddy"
    sudo systemctl reload caddy || sudo systemctl restart caddy
  elif systemctl is-active --quiet nginx 2>/dev/null; then
    log "Reloading nginx"
    sudo nginx -t
    sudo systemctl reload nginx || sudo systemctl restart nginx
  fi
}

verify_deploy() {
  log "Verifying backend health"

  wait_for_url "local backend" "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null
  wait_for_url "local API health" "http://127.0.0.1:$BACKEND_PORT/api/health"

  log "Verifying public domain health"

  wait_for_url "public API health" "https://$DOMAIN_HOST/api/health"
  curl -fsSI "https://$DOMAIN_HOST/" | sed -n '1,12p'
}

main() {
  require_command git
  require_command npm
  require_command node
  require_command curl
  require_command rsync

  update_repo
  install_dependencies
  build_frontend
  publish_frontend
  restart_backend
  reload_web_server
  verify_deploy

  log "Deployment complete: https://$DOMAIN_HOST/"
}

main "$@"
