#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/rtc-enterprise}"
REPO_URL="${REPO_URL:-https://github.com/triangletechguy/New_Type_RTC.git}"
DOMAIN_HOST="${DOMAIN_HOST:-152-228-135-87.sslip.io}"
DOMAIN="https://$DOMAIN_HOST"
PUBLIC_IP="${PUBLIC_IP:-152.228.135.87}"
WEB_ROOT="${WEB_ROOT:-/var/www/rtc-enterprise}"
PM2_APP="${PM2_APP:-rtc-backend}"

log() {
  printf '\n==> %s\n' "$*"
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
  fi
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

ensure_packages() {
  log "Installing required packages"
  sudo apt-get update
  sudo apt-get install -y git curl rsync mysql-server caddy coturn
}

ensure_repo() {
  if [ -d "$APP_DIR/.git" ]; then
    log "Updating repo at $APP_DIR"
    cd "$APP_DIR"
    git fetch origin main
    git reset --hard origin/main
  else
    log "Cloning repo to $APP_DIR"
    if [ -e "$APP_DIR" ]; then
      mv "$APP_DIR" "$APP_DIR.backup.$(date +%Y%m%d%H%M%S)"
    fi
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
}

write_env_files() {
  log "Writing production env files"

  db_password="$(get_env DB_PASSWORD backend/.env)"
  jwt_secret="$(get_env JWT_SECRET backend/.env)"
  turn_credential="$(get_env TURN_CREDENTIAL backend/.env)"

  if [ -z "$db_password" ]; then db_password="$(random_hex 24)"; fi
  if [ -z "$jwt_secret" ]; then jwt_secret="$(random_hex 32)"; fi
  if [ -z "$turn_credential" ] || [ "$turn_credential" = "YOUR_TURN_PASSWORD" ]; then
    turn_credential="$(random_hex 20)"
  fi

  set_env NODE_ENV production
  set_env PORT 8000
  set_env FRONTEND_ORIGINS "$DOMAIN,http://$DOMAIN_HOST"
  set_env DB_HOST 127.0.0.1
  set_env DB_PORT 3306
  set_env DB_DATABASE rtc_platform
  set_env DB_USER rtc_user
  set_env DB_PASSWORD "$db_password"
  set_env JWT_SECRET "$jwt_secret"
  set_env JWT_EXPIRES_IN 7d
  set_env STUN_URLS stun:stun.l.google.com:19302
  set_env TURN_URLS "turn:$DOMAIN_HOST:3478?transport=udp,turn:$DOMAIN_HOST:3478?transport=tcp"
  set_env TURN_USERNAME rtcuser
  set_env TURN_CREDENTIAL "$turn_credential"
  set_env RTC_ICE_TRANSPORT_POLICY all

  cat > frontend/.env <<EOF
VITE_API_BASE_URL=$DOMAIN/api
VITE_SIGNALING_SERVER_URL=$DOMAIN
VITE_MEDIA_MODE=real
VITE_APP_NAME=talkeachother RTC
EOF
}

configure_mysql() {
  log "Configuring MySQL"

  set -a
  . backend/.env
  set +a

  sudo systemctl enable --now mysql >/dev/null 2>&1 || sudo systemctl start mysql

  sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_DATABASE}\`.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_DATABASE}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
}

configure_turn() {
  log "Configuring TURN relay"

  set -a
  . backend/.env
  set +a

  if [ -f /etc/turnserver.conf ]; then
    sudo cp /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%Y%m%d%H%M%S)"
  fi

  sudo tee /etc/turnserver.conf >/dev/null <<EOF
listening-port=3478
fingerprint
lt-cred-mech
user=${TURN_USERNAME}:${TURN_CREDENTIAL}
realm=${DOMAIN_HOST}
server-name=${DOMAIN_HOST}
external-ip=${PUBLIC_IP}
min-port=49152
max-port=65535
no-multicast-peers
no-cli
EOF

  if [ -f /etc/default/coturn ]; then
    if grep -q '^#\?TURNSERVER_ENABLED=' /etc/default/coturn; then
      sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
    else
      echo 'TURNSERVER_ENABLED=1' | sudo tee -a /etc/default/coturn >/dev/null
    fi
  fi

  sudo systemctl enable --now coturn >/dev/null 2>&1 || true
  sudo systemctl restart coturn

  if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw allow 3478/tcp
    sudo ufw allow 3478/udp
    sudo ufw allow 49152:65535/udp
  fi
}

build_and_publish() {
  log "Installing dependencies"
  npm run install:all

  log "Initializing database"
  npm run db:init
  npm run db:seed

  log "Building frontend"
  npm --prefix frontend run build

  log "Publishing frontend"
  sudo mkdir -p "$WEB_ROOT"
  sudo rsync -a --delete frontend/dist/ "$WEB_ROOT/"
}

configure_caddy() {
  log "Configuring Caddy"

  sudo systemctl disable --now nginx >/dev/null 2>&1 || true

  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN_HOST {
    encode gzip
    root * $WEB_ROOT

    handle /api/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /socket.io/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /health {
        reverse_proxy 127.0.0.1:8000
    }

    handle {
        try_files {path} /index.html
        file_server
    }
}
EOF

  sudo caddy fmt --overwrite /etc/caddy/Caddyfile
  sudo systemctl enable --now caddy
  sudo systemctl restart caddy
}

restart_backend() {
  log "Restarting backend"

  if ! command -v pm2 >/dev/null 2>&1; then
    sudo npm install -g pm2
  fi

  pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --env production --update-env
  pm2 save
}

verify() {
  log "Verifying deployment"

  sleep 3
  health="$(curl -fsS "$DOMAIN/api/health")"
  printf '%s\n' "$health"
  case "$health" in
    *'"status":"ok"'*) ;;
    *) echo "API health did not return JSON from the backend."; exit 1 ;;
  esac

  rtc_config="$(curl -fsS "$DOMAIN/api/rtc/config")"
  printf '%s\n' "$rtc_config"
  case "$rtc_config" in
    *'"iceServers"'*) ;;
    *) echo "RTC config did not return JSON from the backend."; exit 1 ;;
  esac
}

main() {
  ensure_packages
  ensure_repo
  write_env_files
  configure_mysql
  configure_turn
  build_and_publish
  restart_backend
  configure_caddy
  verify

  log "Deployment complete: $DOMAIN"
}

main "$@"
