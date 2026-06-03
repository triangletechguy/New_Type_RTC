#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/rtc-enterprise}"
REPO_URL="${REPO_URL:-https://github.com/triangletechguy/New_Type_RTC.git}"
DOMAIN="${DOMAIN:-https://152.228.135.87.sslip.io}"
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

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
}

has_file() {
  sudo test -f "$1"
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
  set_env FRONTEND_ORIGINS "$DOMAIN,http://$PUBLIC_HOST,https://$PUBLIC_IP,http://$PUBLIC_IP"
  set_env DB_HOST 127.0.0.1
  set_env DB_PORT 3306
  set_env DB_DATABASE rtc_platform
  set_env DB_USER rtc_user
  set_env DB_PASSWORD "$db_password"
  set_env JWT_SECRET "$jwt_secret"
  set_env JWT_EXPIRES_IN 7d
  set_env STUN_URLS stun:stun.l.google.com:19302

  if [ "$SETUP_TURN" = "1" ]; then
    turn_secret="${TURN_SHARED_SECRET:-$(get_env TURN_SHARED_SECRET backend/.env)}"
    if [ -z "$turn_secret" ]; then turn_secret="${TURN_AUTH_SECRET:-$(get_env TURN_AUTH_SECRET backend/.env)}"; fi
    if [ -z "$turn_secret" ]; then turn_secret="$(get_env TURN_CREDENTIAL backend/.env)"; fi
    if [ -z "$turn_secret" ] || [ "$turn_secret" = "YOUR_TURN_PASSWORD" ]; then
      turn_secret="$(random_hex 32)"
    fi

    set_env TURN_URLS "turn:$PUBLIC_HOST:3478?transport=udp,turn:$PUBLIC_HOST:3478?transport=tcp"
    set_env TURN_SHARED_SECRET "$turn_secret"
    set_env TURN_AUTH_SECRET "$turn_secret"
    set_env TURN_TTL_SECONDS "${TURN_TTL_SECONDS:-3600}"
    set_env RTC_ICE_TRANSPORT_POLICY all
  else
    set_env RTC_ICE_TRANSPORT_POLICY all
  fi
}

configure_mysql() {
  log "Fixing MySQL database, user, and grants"

  db_database="$(get_env DB_DATABASE)"
  db_user="$(get_env DB_USER)"
  db_password="$(get_env DB_PASSWORD)"
  db_database_sql="$(sql_escape "$db_database")"
  db_user_sql="$(sql_escape "$db_user")"
  db_password_sql="$(sql_escape "$db_password")"

  sudo systemctl enable --now mysql >/dev/null 2>&1 || sudo systemctl start mysql

  sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${db_database_sql}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${db_user_sql}'@'localhost' IDENTIFIED BY '${db_password_sql}';
ALTER USER '${db_user_sql}'@'localhost' IDENTIFIED BY '${db_password_sql}';
CREATE USER IF NOT EXISTS '${db_user_sql}'@'127.0.0.1' IDENTIFIED BY '${db_password_sql}';
ALTER USER '${db_user_sql}'@'127.0.0.1' IDENTIFIED BY '${db_password_sql}';
GRANT ALL PRIVILEGES ON \`${db_database_sql}\`.* TO '${db_user_sql}'@'localhost';
GRANT ALL PRIVILEGES ON \`${db_database_sql}\`.* TO '${db_user_sql}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
}

configure_turn() {
  if [ "$SETUP_TURN" != "1" ]; then
    return
  fi

  log "Configuring coturn for WebRTC relay"

  turn_secret="$(get_env TURN_SHARED_SECRET)"
  if [ -z "$turn_secret" ]; then turn_secret="$(get_env TURN_AUTH_SECRET)"; fi
  if [ -z "$turn_secret" ]; then
    echo "ERROR: TURN_SHARED_SECRET is missing. Run write_backend_env before configure_turn." >&2
    exit 1
  fi
  turn_realm="${TURN_REALM:-$PUBLIC_HOST}"
  turn_min_port="${TURN_MIN_PORT:-49152}"
  turn_max_port="${TURN_MAX_PORT:-65535}"
  turn_cert_dir="/etc/coturn/certs"
  turn_cert="$turn_cert_dir/$PUBLIC_HOST.crt"
  turn_key="$turn_cert_dir/$PUBLIC_HOST.key"
  tls_ready=0

  if ! command -v turnserver >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y coturn
  fi

  if [ -f /etc/turnserver.conf ]; then
    sudo cp /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%Y%m%d%H%M%S)"
  fi

  sudo mkdir -p "$turn_cert_dir"
  letsencrypt_cert="/etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem"
  letsencrypt_key="/etc/letsencrypt/live/$PUBLIC_HOST/privkey.pem"
  if has_file "$letsencrypt_cert" && has_file "$letsencrypt_key"; then
    sudo install -m 0644 "$letsencrypt_cert" "$turn_cert"
    sudo install -m 0640 "$letsencrypt_key" "$turn_key"
    if id turnserver >/dev/null 2>&1; then
      sudo chown turnserver:turnserver "$turn_cert" "$turn_key"
    fi
    tls_ready=1
  fi

  turn_urls="turn:$PUBLIC_HOST:3478?transport=udp,turn:$PUBLIC_HOST:3478?transport=tcp"
  if [ "$tls_ready" -eq 1 ]; then
    turn_urls="$turn_urls,turns:$PUBLIC_HOST:5349?transport=tcp"
  fi
  set_env TURN_URLS "$turn_urls"
  set_env TURN_SHARED_SECRET "$turn_secret"
  set_env TURN_AUTH_SECRET "$turn_secret"

sudo tee /etc/turnserver.conf >/dev/null <<EOF
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${turn_secret}
realm=${turn_realm}
server-name=${turn_realm}
external-ip=${PUBLIC_IP}
min-port=${turn_min_port}
max-port=${turn_max_port}
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
EOF

  if [ "$tls_ready" -eq 1 ]; then
    sudo tee -a /etc/turnserver.conf >/dev/null <<EOF
tls-listening-port=5349
cert=${turn_cert}
pkey=${turn_key}
EOF
  fi

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
    sudo ufw allow 5349/tcp
    sudo ufw allow "$turn_min_port:$turn_max_port/udp"
  fi
}

release_web_ports() {
  log "Preparing HTTP/HTTPS ports for nginx"

  for service in apache2 httpd caddy; do
    if systemctl list-unit-files "$service.service" --no-legend 2>/dev/null | grep -q "$service.service"; then
      sudo systemctl stop "$service" >/dev/null 2>&1 || true
      sudo systemctl disable "$service" >/dev/null 2>&1 || true
    fi
  done

  if command -v ss >/dev/null 2>&1; then
    blockers="$(sudo ss -ltnp 2>/dev/null | awk 'NR > 1 && ($4 ~ /:80$/ || $4 ~ /:443$/) && $0 !~ /nginx/ { print }')"
    if [ -n "$blockers" ]; then
      printf '\nPort 80/443 is still used by another process:\n%s\n' "$blockers" >&2
      printf 'Stop that process, then run this repair script again.\n' >&2
      exit 1
    fi
  fi

  sudo systemctl enable nginx >/dev/null 2>&1 || true
}

open_web_firewall() {
  if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
  fi
}

restart_nginx() {
  sudo nginx -t

  if ! sudo systemctl restart nginx; then
    sudo systemctl status nginx --no-pager -l || true
    sudo journalctl -xeu nginx.service --no-pager -n 100 || true
    sudo ss -ltnp 2>/dev/null | awk 'NR == 1 || $4 ~ /:80$/ || $4 ~ /:443$/ { print }' || true
    exit 1
  fi

  sleep 1
  if command -v ss >/dev/null 2>&1 && ! sudo ss -ltnp | awk '$4 ~ /:80$/ || $4 ~ /:443$/ { found = 1 } END { exit found ? 0 : 1 }'; then
    printf 'nginx restarted, but it is not listening on port 80 or 443.\n' >&2
    sudo systemctl status nginx --no-pager -l || true
    sudo journalctl -xeu nginx.service --no-pager -n 100 || true
    exit 1
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

  if has_file "$ssl_cert" && has_file "$ssl_key"; then
    sudo tee "$nginx_site" >/dev/null <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name $PUBLIC_HOST;

    location ^~ /.well-known/acme-challenge/ {
        root $WEB_ROOT;
        try_files \$uri =404;
    }

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

    location ^~ /.well-known/acme-challenge/ {
        root $WEB_ROOT;
        try_files \$uri =404;
    }

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

    location ^~ /.well-known/acme-challenge/ {
        root $WEB_ROOT;
        try_files \$uri =404;
    }

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
  restart_nginx
}

ensure_https_certificate() {
  case "$DOMAIN" in
    https://*) ;;
    *) return ;;
  esac

  ssl_cert="/etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem"
  ssl_key="/etc/letsencrypt/live/$PUBLIC_HOST/privkey.pem"

  if has_file "$ssl_cert" && has_file "$ssl_key"; then
    return
  fi

  log "Requesting HTTPS certificate for $PUBLIC_HOST"

  if ! command -v certbot >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y certbot
  fi

  restart_nginx
  sudo certbot certonly \
    --webroot \
    --webroot-path "$WEB_ROOT" \
    -d "$PUBLIC_HOST" \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    --keep-until-expiring

  if ! has_file "$ssl_cert" || ! has_file "$ssl_key"; then
    log "Certificate metadata exists but nginx certificate files are missing; forcing certificate repair"

    sudo certbot certonly \
      --webroot \
      --webroot-path "$WEB_ROOT" \
      -d "$PUBLIC_HOST" \
      --non-interactive \
      --agree-tos \
      --register-unsafely-without-email \
      --force-renewal
  fi

  if ! has_file "$ssl_cert" || ! has_file "$ssl_key"; then
    sudo certbot certificates || true
    printf 'HTTPS certificate files were not created at %s and %s.\n' "$ssl_cert" "$ssl_key" >&2
    exit 1
  fi

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
    --data '{"email":"admin@gmail.com","password":"admin@gmail.com"}' >/dev/null
  printf 'Login check passed for admin@gmail.com\n'
}

main() {
  install_missing_packages
  ensure_repo
  write_backend_env
  configure_mysql
  write_frontend_env
  install_and_build
  release_web_ports
  open_web_firewall
  write_nginx_config
  ensure_https_certificate
  configure_turn
  restart_backend
  verify_deploy

  log "Repair complete: $DOMAIN"
}

main "$@"
