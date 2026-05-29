#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/rtc-enterprise}"
REPO_URL="${REPO_URL:-https://github.com/triangletechguy/New_Type_RTC.git}"
DOMAIN="${DOMAIN:-https://152-228-135-87.sslip.io}"
PUBLIC_IP="${PUBLIC_IP:-152.228.135.87}"
PUBLIC_HOST="${PUBLIC_HOST:-${DOMAIN#https://}}"
PUBLIC_HOST="${PUBLIC_HOST#http://}"
WEB_ROOT="${WEB_ROOT:-/var/www/rtc-enterprise}"
PM2_APP="${PM2_APP:-rtc-backend}"
SETUP_TURN="${SETUP_TURN:-1}"

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
    END {
      if (!found) print key "=" value
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
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

install_missing_packages() {
  packages=""

  command -v git >/dev/null 2>&1 || packages="$packages git"
  command -v nginx >/dev/null 2>&1 || packages="$packages nginx"
  command -v mysql >/dev/null 2>&1 || packages="$packages mysql-server"
  command -v rsync >/dev/null 2>&1 || packages="$packages rsync"
  command -v curl >/dev/null 2>&1 || packages="$packages curl"

  if [ "$SETUP_TURN" = "1" ] && ! command -v turnserver >/dev/null 2>&1; then
    packages="$packages coturn"
  fi

  if [ -n "$packages" ]; then
    log "Installing missing system packages:$packages"
    sudo apt-get update
    sudo apt-get install -y $packages
  fi
}

ensure_repo() {
  if [ -d "$APP_DIR/.git" ]; then
    log "Updating existing repo at $APP_DIR"
    cd "$APP_DIR"
    git pull --ff-only origin main || {
      git fetch origin main
      git reset --hard origin/main
    }
  else
    log "Cloning repo to $APP_DIR"
    if [ -e "$APP_DIR" ]; then
      mv "$APP_DIR" "$APP_DIR.backup.$(date +%Y%m%d%H%M%S)"
    fi
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
}

write_backend_env() {
  log "Writing backend production environment"

  db_password="$(random_hex 24)"
  jwt_secret="$(get_env JWT_SECRET backend/.env)"
  if [ -z "$jwt_secret" ]; then
    jwt_secret="$(random_hex 32)"
  fi

  set_env NODE_ENV production
  set_env PORT 8000
  set_env FRONTEND_ORIGINS "$DOMAIN,https://$PUBLIC_IP,http://$PUBLIC_IP"
  set_env DB_HOST 127.0.0.1
  set_env DB_PORT 3306
  set_env DB_DATABASE rtc_platform
  set_env DB_USER rtc_user
  set_env DB_PASSWORD "$db_password"
  set_env JWT_SECRET "$jwt_secret"
  set_env JWT_EXPIRES_IN 7d
  set_env STUN_URLS stun:stun.l.google.com:19302

  if [ "$SETUP_TURN" = "1" ]; then
    turn_username="$(get_env TURN_USERNAME backend/.env)"
    if [ -z "$turn_username" ]; then
      turn_username="rtcuser"
    fi

    turn_credential="$(get_env TURN_CREDENTIAL backend/.env)"
    if [ -z "$turn_credential" ] || [ "$turn_credential" = "YOUR_TURN_PASSWORD" ]; then
      turn_credential="$(random_hex 20)"
    fi

    set_env TURN_URLS "turn:$PUBLIC_HOST:3478?transport=udp,turn:$PUBLIC_HOST:3478?transport=tcp"
    set_env TURN_USERNAME "$turn_username"
    set_env TURN_CREDENTIAL "$turn_credential"
    set_env RTC_ICE_TRANSPORT_POLICY relay
  else
    set_env RTC_ICE_TRANSPORT_POLICY all
  fi
}

configure_mysql() {
  log "Fixing MySQL database, user, and grants"

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
  if [ "$SETUP_TURN" != "1" ]; then
    return
  fi

  log "Configuring coturn for WebRTC relay"

  set -a
  . backend/.env
  set +a

  if ! command -v turnserver >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y coturn
  fi

  if [ -f /etc/turnserver.conf ]; then
    sudo cp /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%Y%m%d%H%M%S)"
  fi

  sudo tee /etc/turnserver.conf >/dev/null <<EOF
listening-port=3478
fingerprint
lt-cred-mech
user=${TURN_USERNAME}:${TURN_CREDENTIAL}
realm=${PUBLIC_HOST}
server-name=${PUBLIC_HOST}
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

write_frontend_env() {
  log "Writing frontend production environment"

  cat > frontend/.env <<EOF
VITE_API_BASE_URL=${DOMAIN}/api
VITE_SIGNALING_SERVER_URL=${DOMAIN}
VITE_MEDIA_MODE=real
VITE_APP_NAME=talkeachother RTC
EOF
}

install_and_build() {
  log "Installing dependencies"
  npm run install:all

  log "Initializing and seeding database"
  npm run db:init
  npm run db:seed

  log "Building frontend"
  npm --prefix frontend run build

  log "Publishing frontend to $WEB_ROOT"
  sudo mkdir -p "$WEB_ROOT"
  sudo rsync -a --delete frontend/dist/ "$WEB_ROOT/"
}

write_nginx_config() {
  log "Writing nginx config"

  ssl_cert="/etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem"
  ssl_key="/etc/letsencrypt/live/$PUBLIC_HOST/privkey.pem"
  nginx_site="/etc/nginx/sites-available/rtc-enterprise"

  if [ -f "$ssl_cert" ] && [ -f "$ssl_key" ]; then
    sudo tee "$nginx_site" >/dev/null <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name $PUBLIC_HOST;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $PUBLIC_HOST;

    ssl_certificate $ssl_cert;
    ssl_certificate_key $ssl_key;

    root $WEB_ROOT;
    index index.html;
    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:8000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  else
    sudo tee "$nginx_site" >/dev/null <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name $PUBLIC_HOST _;

    root $WEB_ROOT;
    index index.html;
    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:8000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
  fi

  sudo ln -sf "$nginx_site" /etc/nginx/sites-enabled/rtc-enterprise
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl reload nginx || sudo systemctl restart nginx
}

ensure_https_certificate() {
  case "$DOMAIN" in
    https://*) ;;
    *) return ;;
  esac

  ssl_cert="/etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem"
  ssl_key="/etc/letsencrypt/live/$PUBLIC_HOST/privkey.pem"

  if [ -f "$ssl_cert" ] && [ -f "$ssl_key" ]; then
    return
  fi

  log "Requesting HTTPS certificate for $PUBLIC_HOST"

  if ! command -v certbot >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y certbot
  fi

  sudo systemctl restart nginx
  sudo certbot certonly \
    --webroot \
    --webroot-path "$WEB_ROOT" \
    -d "$PUBLIC_HOST" \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    --keep-until-expiring

  write_nginx_config
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

verify_deploy() {
  log "Verifying live deployment"

  sleep 2
  curl -fk "$DOMAIN/api/health"
  printf '\n'
  curl -fk "$DOMAIN/api/rtc/config"
  printf '\n'
  curl -fk "$DOMAIN/api/auth/login" \
    -H 'Content-Type: application/json' \
    --data '{"email":"admin@rtc.com","password":"Admin@123456"}' >/dev/null
  printf 'Login check passed for admin@rtc.com\n'
}

main() {
  install_missing_packages
  ensure_repo
  write_backend_env
  configure_mysql
  configure_turn
  write_frontend_env
  install_and_build
  write_nginx_config
  ensure_https_certificate
  restart_backend
  verify_deploy

  log "Repair complete: $DOMAIN"
}

main "$@"
