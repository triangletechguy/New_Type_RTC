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

sql_escape() {
  printf '%s' "$1" | sed "s/'/''/g"
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
  turn_secret="${TURN_SHARED_SECRET:-$(get_env TURN_SHARED_SECRET backend/.env)}"
  if [ -z "$turn_secret" ]; then turn_secret="${TURN_AUTH_SECRET:-$(get_env TURN_AUTH_SECRET backend/.env)}"; fi
  if [ -z "$turn_secret" ]; then turn_secret="$(get_env TURN_CREDENTIAL backend/.env)"; fi
  feedback_to_email="$(get_env FEEDBACK_TO_EMAIL backend/.env)"
  resend_api_key="${RESEND_API_KEY:-$(get_env RESEND_API_KEY backend/.env)}"
  email_provider="${EMAIL_PROVIDER:-${MAIL_MAILER:-$(get_env EMAIL_PROVIDER backend/.env)}}"
  email_from="${EMAIL_FROM:-${SMTP_FROM:-$(get_env EMAIL_FROM backend/.env)}}"
  if [ -z "$email_from" ]; then email_from="$(get_env SMTP_FROM backend/.env)"; fi
  mail_from_address="${MAIL_FROM_ADDRESS:-$(get_env MAIL_FROM_ADDRESS backend/.env)}"
  mail_from_name="${MAIL_FROM_NAME:-$(get_env MAIL_FROM_NAME backend/.env)}"
  smtp_host="${SMTP_HOST:-${MAIL_HOST:-$(get_env SMTP_HOST backend/.env)}}"
  smtp_port="${SMTP_PORT:-${MAIL_PORT:-$(get_env SMTP_PORT backend/.env)}}"
  smtp_user="${SMTP_USER:-${MAIL_USERNAME:-$(get_env SMTP_USER backend/.env)}}"
  smtp_pass="${SMTP_PASS:-${MAIL_PASSWORD:-$(get_env SMTP_PASS backend/.env)}}"
  smtp_from="${SMTP_FROM:-${EMAIL_FROM:-$(get_env SMTP_FROM backend/.env)}}"
  smtp_secure="${SMTP_SECURE:-${MAIL_ENCRYPTION:-$(get_env SMTP_SECURE backend/.env)}}"

  if [ -z "$db_password" ]; then db_password="$(random_hex 24)"; fi
  if [ -z "$jwt_secret" ]; then jwt_secret="$(random_hex 32)"; fi
  if [ -z "$feedback_to_email" ]; then feedback_to_email="${FEEDBACK_TO_EMAIL:-admin@gmail.com}"; fi
  if [ -z "$email_from" ] && [ -n "$mail_from_address" ]; then
    if [ -n "$mail_from_name" ]; then
      email_from="$mail_from_name <$mail_from_address>"
    else
      email_from="$mail_from_address"
    fi
  fi
  if [ -z "$smtp_from" ]; then smtp_from="$email_from"; fi
  if [ -z "$turn_secret" ] || [ "$turn_secret" = "YOUR_TURN_PASSWORD" ]; then
    turn_secret="$(random_hex 32)"
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
  set_env TURN_SHARED_SECRET "$turn_secret"
  set_env TURN_AUTH_SECRET "$turn_secret"
  set_env TURN_TTL_SECONDS "${TURN_TTL_SECONDS:-3600}"
  set_env RTC_ICE_TRANSPORT_POLICY all
  set_env FEEDBACK_TO_EMAIL "$feedback_to_email"
  if [ -n "$email_provider" ]; then set_env EMAIL_PROVIDER "$email_provider"; fi
  if [ -n "$resend_api_key" ]; then set_env RESEND_API_KEY "$resend_api_key"; fi
  if [ -n "$email_from" ]; then set_env EMAIL_FROM "$email_from"; fi
  if [ -n "$smtp_host" ]; then set_env SMTP_HOST "$smtp_host"; fi
  if [ -n "$smtp_port" ]; then set_env SMTP_PORT "$smtp_port"; fi
  if [ -n "$smtp_user" ]; then set_env SMTP_USER "$smtp_user"; fi
  if [ -n "$smtp_pass" ]; then set_env SMTP_PASS "$smtp_pass"; fi
  if [ -n "$smtp_from" ]; then set_env SMTP_FROM "$smtp_from"; fi
  if [ -n "$smtp_secure" ]; then set_env SMTP_SECURE "$smtp_secure"; fi
  if [ -n "$mail_from_address" ]; then set_env MAIL_FROM_ADDRESS "$mail_from_address"; fi
  if [ -n "$mail_from_name" ]; then set_env MAIL_FROM_NAME "$mail_from_name"; fi

  email_ready=0
  if [ -n "$resend_api_key" ] && [ -n "$email_from" ]; then email_ready=1; fi
  if [ -n "$smtp_host" ] && [ -n "$smtp_port" ] && [ -n "$smtp_user" ] && [ -n "$smtp_pass" ] && [ -n "$smtp_from" ]; then email_ready=1; fi
  smtp_ready=0
  if [ -n "$smtp_host" ] && [ -n "$smtp_port" ] && [ -n "$smtp_user" ] && [ -n "$smtp_pass" ] && [ -n "$smtp_from" ]; then smtp_ready=1; fi
  resend_ready=0
  if [ -n "$resend_api_key" ] && [ -n "$email_from" ]; then resend_ready=1; fi

  if [ "${REQUIRE_EMAIL_DELIVERY:-true}" != "false" ] && [ "$email_ready" -ne 1 ]; then
    cat >&2 <<EOF
ERROR: Email delivery is required for production signup verification.

Deploy with Resend:
  RESEND_API_KEY='re_xxxxxxxxx' EMAIL_FROM='TalkEachOther <verify@chadnichok.com>' DOMAIN_HOST=$DOMAIN_HOST PUBLIC_IP=$PUBLIC_IP bash scripts/deploy-vps-caddy.sh

Or deploy with SMTP:
  SMTP_HOST='smtp.example.com' SMTP_PORT='587' SMTP_USER='user@example.com' SMTP_PASS='password' SMTP_FROM='TalkEachOther <user@example.com>' DOMAIN_HOST=$DOMAIN_HOST PUBLIC_IP=$PUBLIC_IP bash scripts/deploy-vps-caddy.sh

Prefer provider explicitly if both are set:
  EMAIL_PROVIDER=smtp
  SMTP_HOST='smtp.example.com' SMTP_PORT='587' SMTP_USER='user@example.com' SMTP_PASS='password' SMTP_FROM='TalkEachOther <user@example.com>' RESEND_API_KEY='re_xxxxxxxxx' DOMAIN_HOST=$DOMAIN_HOST PUBLIC_IP=$PUBLIC_IP bash scripts/deploy-vps-caddy.sh

Laravel-style MAIL_* variables are also accepted:
  MAIL_HOST='smtp.example.com' MAIL_PORT='587' MAIL_USERNAME='user@example.com' MAIL_PASSWORD='password' MAIL_FROM_ADDRESS='user@example.com' MAIL_FROM_NAME='TalkEachOther' DOMAIN_HOST=$DOMAIN_HOST PUBLIC_IP=$PUBLIC_IP bash scripts/deploy-vps-caddy.sh
EOF
    exit 1
  fi

  if [ -n "$resend_api_key" ]; then
    provider_preference="${email_provider,,}"
    validate_resend=0

    case "$provider_preference" in
      resend)
        validate_resend=1
        ;;
      smtp|mail|nodemailer)
        if [ "$smtp_ready" -eq 1 ]; then
          validate_resend=0
        else
          validate_resend=1
        fi
        ;;
      *)
        if [ "$smtp_ready" -eq 0 ]; then
          validate_resend=1
        fi
        ;;
    esac

    if [ "$validate_resend" -eq 0 ]; then
      log "Skipping Resend key validation because EMAIL_PROVIDER=$email_provider and SMTP looks ready"
    else
      case "$resend_api_key" in
      YOUR_REAL_RESEND_KEY|re_xxxxxxxxx|re_xxxxxxxx*|example*|placeholder*)
        echo "ERROR: RESEND_API_KEY is still a placeholder. Use a real key from Resend." >&2
        exit 1
        ;;
      esac

      resend_status="$(curl -sS -o /tmp/resend-deploy-check.json -w "%{http_code}" \
        -H "Authorization: Bearer $resend_api_key" \
        https://api.resend.com/domains || true)"
      if [ "$resend_status" = "401" ]; then
        echo "ERROR: RESEND_API_KEY is invalid. Create a valid Resend API key and deploy again." >&2
        exit 1
      fi
      if [ "$resend_status" -lt 200 ] || [ "$resend_status" -ge 500 ]; then
        echo "ERROR: Could not validate Resend API key right now. Resend API returned HTTP $resend_status." >&2
        exit 1
      fi
    fi
  fi

  cat > frontend/.env <<EOF
VITE_API_BASE_URL=$DOMAIN/api
VITE_SIGNALING_SERVER_URL=$DOMAIN
VITE_MEDIA_MODE=real
VITE_APP_NAME=talkeachother RTC
EOF
}

configure_mysql() {
  log "Configuring MySQL"

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
  log "Configuring TURN relay"

  turn_secret="$(get_env TURN_SHARED_SECRET)"
  if [ -z "$turn_secret" ]; then turn_secret="$(get_env TURN_AUTH_SECRET)"; fi
  if [ -z "$turn_secret" ]; then
    echo "ERROR: TURN_SHARED_SECRET is missing. Run write_env_files before configure_turn." >&2
    exit 1
  fi

  turn_realm="${TURN_REALM:-$DOMAIN_HOST}"
  turn_min_port="${TURN_MIN_PORT:-49152}"
  turn_max_port="${TURN_MAX_PORT:-65535}"
  turn_cert_dir="/etc/coturn/certs"
  turn_cert="$turn_cert_dir/$DOMAIN_HOST.crt"
  turn_key="$turn_cert_dir/$DOMAIN_HOST.key"
  tls_ready=0

  if [ -f /etc/turnserver.conf ]; then
    sudo cp /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%Y%m%d%H%M%S)"
  fi

  sudo mkdir -p "$turn_cert_dir"
  caddy_cert="$(sudo find /var/lib/caddy/.local/share/caddy/certificates -type f -name "$DOMAIN_HOST.crt" 2>/dev/null | head -n 1 || true)"
  caddy_key="$(sudo find /var/lib/caddy/.local/share/caddy/certificates -type f -name "$DOMAIN_HOST.key" 2>/dev/null | head -n 1 || true)"
  if [ -n "$caddy_cert" ] && [ -n "$caddy_key" ]; then
    sudo install -m 0644 "$caddy_cert" "$turn_cert"
    sudo install -m 0640 "$caddy_key" "$turn_key"
    if id turnserver >/dev/null 2>&1; then
      sudo chown turnserver:turnserver "$turn_cert" "$turn_key"
    fi
    tls_ready=1
  else
    log "Caddy TLS certificate was not found yet; TURN will run on UDP/TCP 3478 now. Re-run deploy after Caddy has issued the certificate to enable turns:5349."
  fi

  turn_urls="turn:$DOMAIN_HOST:3478?transport=udp,turn:$DOMAIN_HOST:3478?transport=tcp"
  if [ "$tls_ready" -eq 1 ]; then
    turn_urls="$turn_urls,turns:$DOMAIN_HOST:5349?transport=tcp"
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
    header {
        Permissions-Policy "camera=(self), microphone=(self), display-capture=(self)"
    }
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
  sudo systemctl restart caddy
  curl -fsS --retry 4 --retry-delay 2 "$DOMAIN/" >/dev/null 2>&1 || true
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
  case "$rtc_config" in
    *'"turnConfigured":true'*) ;;
    *) echo "RTC config does not show TURN as configured."; exit 1 ;;
  esac
  case "$rtc_config" in
    *'"turnCredentialType":"ephemeral"'*) ;;
    *) echo "RTC config is not using short-lived TURN credentials."; exit 1 ;;
  esac
}

main() {
  ensure_packages
  ensure_repo
  write_env_files
  configure_mysql
  build_and_publish
  configure_caddy
  configure_turn
  restart_backend
  verify

  log "Deployment complete: $DOMAIN"
}

main "$@"
