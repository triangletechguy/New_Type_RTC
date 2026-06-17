#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/rtc-enterprise}"
DOMAIN_HOST="${DOMAIN_HOST:-funint.online}"
WWW_DOMAIN_HOST="${WWW_DOMAIN_HOST:-www.funint.online}"
WEB_ROOT="${WEB_ROOT:-/var/www/rtc-enterprise}"
PM2_APP="${PM2_APP:-rtc-backend}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
DB_DUMP="${DB_DUMP:-}"

log() {
  printf '\n==> %s\n' "$*"
}

get_env() {
  key="$1"
  file="${2:-backend/.env}"
  awk -F= -v key="$key" '$1 == key {
    sub(/^[^=]*=/, "")
    print
    exit
  }' "$file" 2>/dev/null || true
}

set_env() {
  key="$1"
  value="$2"
  file="${3:-backend/.env}"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^[[:space:]]*" key "=" {
      print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $1" >&2
    exit 1
  fi
}

write_env_files() {
  log "Writing production env files"

  set_env NODE_ENV production
  set_env HOST 0.0.0.0
  set_env PORT "$BACKEND_PORT"
  set_env FRONTEND_ORIGINS "https://$DOMAIN_HOST,http://$DOMAIN_HOST,https://$WWW_DOMAIN_HOST,http://$WWW_DOMAIN_HOST"

  cat > frontend/.env <<EOF
VITE_API_BASE_URL=https://$DOMAIN_HOST/api
VITE_SIGNALING_SERVER_URL=https://$DOMAIN_HOST
VITE_MEDIA_MODE=real
VITE_APP_NAME=talkeachother RTC
EOF
}

install_dependencies() {
  log "Installing dependencies"

  npm --prefix backend install --omit=dev
  npm --prefix frontend install
}

prepare_database() {
  log "Preparing database"

  npm --prefix backend run db:init

  if [ -n "$DB_DUMP" ]; then
    if [ ! -f "$DB_DUMP" ]; then
      echo "ERROR: DB_DUMP file not found: $DB_DUMP" >&2
      exit 1
    fi

    db_host="$(get_env DB_HOST)"
    db_port="$(get_env DB_PORT)"
    db_name="$(get_env DB_DATABASE)"
    db_user="$(get_env DB_USER)"
    db_password="$(get_env DB_PASSWORD)"

    : "${db_host:=127.0.0.1}"
    : "${db_port:=3306}"

    log "Importing database dump: $DB_DUMP"
    mysql -h "$db_host" -P "$db_port" -u "$db_user" "-p$db_password" "$db_name" < "$DB_DUMP"
  fi
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
  log "Restarting backend with PM2"

  if ! command -v pm2 >/dev/null 2>&1; then
    sudo npm install -g pm2
  fi

  pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --env production --update-env
  pm2 save
}

configure_caddy() {
  log "Configuring Caddy"

  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN_HOST, $WWW_DOMAIN_HOST {
	encode gzip

	header {
		Permissions-Policy "camera=(self), microphone=(self), display-capture=(self)"
	}

	root * $WEB_ROOT

	handle /api/* {
		reverse_proxy 127.0.0.1:$BACKEND_PORT
	}

	handle /socket.io/* {
		reverse_proxy 127.0.0.1:$BACKEND_PORT
	}

	handle /health {
		reverse_proxy 127.0.0.1:$BACKEND_PORT
	}

	handle /assets/* {
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	handle /mobile-room-reference.mp4 {
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	handle {
		header Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
EOF

  sudo caddy fmt --overwrite /etc/caddy/Caddyfile
  sudo systemctl enable --now caddy
  sudo systemctl reload caddy || sudo systemctl restart caddy
}

verify_deploy() {
  log "Verifying deployment"

  pm2 ls
  curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health"
  printf '\n'
  curl -fsSI "https://$DOMAIN_HOST/" | sed -n '1,12p'
}

main() {
  require_command npm
  require_command node
  require_command curl
  require_command rsync
  require_command caddy
  require_command mysql

  cd "$APP_DIR"

  write_env_files
  install_dependencies
  prepare_database
  build_frontend
  publish_frontend
  restart_backend
  configure_caddy
  verify_deploy

  log "Deployment complete: https://$DOMAIN_HOST/"
}

main "$@"
