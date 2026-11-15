#!/usr/bin/env bash
# HawarSend one-command installer.
#
#   curl -fsSL https://raw.githubusercontent.com/xhawarx/hawarsend/main/install.sh | sudo bash
#
# What it does:
#   1. Installs Docker with the Compose plugin when it is missing.
#   2. Asks for a domain. With a domain, Caddy serves HawarSend over HTTPS with a free
#      Let's Encrypt certificate. Without one, it listens on http://<server-ip>:3000.
#   3. Generates a strong admin password and writes everything to /opt/hawarsend.
#   4. Pulls the image (or builds it from source when the image is unavailable) and starts it.
#
# Options (environment variables, all optional):
#   HAWARSEND_DOMAIN    Domain to serve, for example send.example.com. Skips the question.
#   HAWARSEND_EMAIL     Email for Let's Encrypt expiry notices.
#   HAWARSEND_DIR       Install directory. Default: /opt/hawarsend
#   HAWARSEND_PORT      Host port without a domain. Default: 3000
#   HAWARSEND_IMAGE     Image to run. Default: ghcr.io/xhawarx/hawarsend:latest
#   HAWARSEND_REPO      Git repository used when the image cannot be pulled.
#   HAWARSEND_BRANCH    Branch of that repository. Default: main
#   HAWARSEND_NONINTERACTIVE=1   Never ask, use the values above.
#
# Commands:
#   install.sh            Install or reconfigure.
#   install.sh update     Pull the newest image and restart.
#   install.sh uninstall  Stop and remove the containers. Data stays in the install directory.

set -euo pipefail

DIR="${HAWARSEND_DIR:-/opt/hawarsend}"
IMAGE="${HAWARSEND_IMAGE:-ghcr.io/xhawarx/hawarsend:latest}"
REPO="${HAWARSEND_REPO:-https://github.com/xhawarx/hawarsend.git}"
BRANCH="${HAWARSEND_BRANCH:-main}"
PORT="${HAWARSEND_PORT:-3000}"

if [ -t 1 ]; then
  B=$'\e[1m'; BLUE=$'\e[34m'; GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; N=$'\e[0m'
else
  B=""; BLUE=""; GREEN=""; RED=""; YELLOW=""; N=""
fi
info() { printf '%s==>%s %s\n' "$BLUE" "$N" "$*"; }
ok()   { printf '%s ✓ %s %s\n' "$GREEN" "$N" "$*"; }
warn() { printf '%s ! %s %s\n' "$YELLOW" "$N" "$*"; }
die()  { printf '%s ✗ %s %s\n' "$RED" "$N" "$*" >&2; exit 1; }

# Reads an answer from the terminal even when the script itself arrives through a pipe.
ask() {
  local prompt="$1" default="${2:-}" answer=""
  if [ "${HAWARSEND_NONINTERACTIVE:-0}" = "1" ] || [ ! -r /dev/tty ]; then
    printf '%s' "$default"; return
  fi
  printf '%s' "$prompt" > /dev/tty
  IFS= read -r answer < /dev/tty || true
  printf '%s' "${answer:-$default}"
}

need_root() {
  [ "$(id -u)" -eq 0 ] || die "Run as root, for example: curl -fsSL <url> | sudo bash"
}

compose() { docker compose -f "$DIR/docker-compose.yml" --env-file "$DIR/.env" "$@"; }

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) with Compose found"
    return
  fi
  info "Installing Docker (official convenience script from get.docker.com)"
  command -v curl >/dev/null 2>&1 || die "curl is required"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is missing after install"
  ok "Docker installed"
}

valid_domain() {
  [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]
}

public_ip() {
  curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || echo "localhost"
}

port_busy() {
  (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | awk '{print $4}' | grep -Eq "[:.]$1\$"
}

write_files() {
  local domain="$1" email="$2" base_url="$3"
  mkdir -p "$DIR/data" "$DIR/uploads"
  # The container runs as uid 1001.
  chown -R 1001:1001 "$DIR/data" "$DIR/uploads" 2>/dev/null || true

  local password
  if [ -f "$DIR/.env" ] && grep -q '^ADMIN_PASSWORD=' "$DIR/.env"; then
    password="$(grep '^ADMIN_PASSWORD=' "$DIR/.env" | cut -d= -f2-)"
  else
    password="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)"
  fi

  umask 077
  cat > "$DIR/.env" <<EOF
# HawarSend settings. Change a value, then run: install.sh update
# Every variable: https://github.com/xhawarx/hawarsend/blob/main/docs/user-guide/configuration/environment-variables.md
HAWARSEND_IMAGE=$IMAGE
BASE_URL=$base_url
DOMAIN=$domain
ACME_EMAIL=$email
ADMIN_PASSWORD=$password
HAWARSEND_PORT=$PORT
FILE_MAX_SIZE=5GB
FILE_UPLOAD_QUOTA_BYTES=50GB
EOF
  umask 022

  if [ -n "$domain" ]; then
    cat > "$DIR/Caddyfile" <<'EOF'
{
	email {$ACME_EMAIL}
}

{$DOMAIN} {
	encode zstd gzip
	header -Server
	reverse_proxy hawarsend:3000 {
		# Keep long uploads and downloads alive across a config reload.
		stream_close_delay 24h
	}
}
EOF
    cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  hawarsend:
    image: ${HAWARSEND_IMAGE}
    restart: unless-stopped
    env_file: .env
    environment:
      TRUST_PROXY: "true"
    expose:
      - "3000"
    volumes:
      - ./data:/data
      - ./uploads:/uploads

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - hawarsend
    environment:
      DOMAIN: ${DOMAIN}
      ACME_EMAIL: ${ACME_EMAIL}
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy/data:/data
      - ./caddy/config:/config
EOF
  else
    cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  hawarsend:
    image: ${HAWARSEND_IMAGE}
    restart: unless-stopped
    env_file: .env
    ports:
      - "${HAWARSEND_PORT:-3000}:3000"
    volumes:
      - ./data:/data
      - ./uploads:/uploads
EOF
  fi
  ok "Configuration written to $DIR"
}

pull_or_build() {
  info "Pulling $IMAGE"
  if docker pull "$IMAGE" >/dev/null 2>&1; then
    ok "Image ready"
    return
  fi
  warn "Could not pull $IMAGE, building from source instead (takes a few minutes)"
  command -v git >/dev/null 2>&1 || {
    (apt-get update -qq && apt-get install -y -qq git) >/dev/null 2>&1 \
      || (dnf install -y -q git || yum install -y -q git) >/dev/null 2>&1 \
      || die "git is required to build from source"
  }
  rm -rf "$DIR/src"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR/src"
  IMAGE="hawarsend:local"
  docker build -t "$IMAGE" "$DIR/src"
  sed -i "s|^HAWARSEND_IMAGE=.*|HAWARSEND_IMAGE=$IMAGE|" "$DIR/.env"
  ok "Image built from source"
}

wait_healthy() {
  info "Waiting for HawarSend to start"
  for _ in $(seq 1 90); do
    if compose exec -T hawarsend node -e \
      "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      ok "HawarSend is running"
      return
    fi
    sleep 2
  done
  compose logs --tail 50 hawarsend || true
  die "HawarSend did not become healthy. The logs are above."
}

cmd_install() {
  need_root
  printf '\n%s  HawarSend installer%s\n  End-to-end encrypted file and note sharing\n\n' "$B" "$N"
  install_docker

  local domain="${HAWARSEND_DOMAIN:-}"
  if [ -z "$domain" ]; then
    domain="$(ask "Domain for HawarSend (leave empty to use http://$(public_ip):$PORT): " "")"
  fi
  domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')"

  local email="" base_url
  if [ -n "$domain" ]; then
    valid_domain "$domain" || die "Not a valid domain: $domain"
    for p in 80 443; do
      if port_busy "$p" && ! docker ps --format '{{.Ports}}' | grep -q ":$p->"; then
        die "Port $p is in use by another program. HawarSend's HTTPS proxy needs ports 80 and 443."
      fi
    done
    email="${HAWARSEND_EMAIL:-$(ask "Email for Let's Encrypt notices (optional): " "")}"
    base_url="https://$domain"
    warn "Point the DNS A record of $domain to $(public_ip) before the first visit."
  else
    base_url="http://$(public_ip):$PORT"
    warn "Without a domain there is no HTTPS. Browsers only allow the encryption on HTTPS or"
    warn "localhost, so use a domain for real use."
  fi

  write_files "$domain" "$email" "$base_url"
  pull_or_build
  compose up -d --remove-orphans
  wait_healthy

  local password
  password="$(grep '^ADMIN_PASSWORD=' "$DIR/.env" | cut -d= -f2-)"
  printf '\n%s  HawarSend is ready%s\n\n' "$B$GREEN" "$N"
  printf '  Open:            %s\n' "$base_url"
  printf '  Admin panel:     %s/admin\n' "$base_url"
  printf '  Admin password:  %s\n' "$password"
  printf '  Settings:        %s/.env\n' "$DIR"
  printf '  Update later:    curl -fsSL https://raw.githubusercontent.com/xhawarx/hawarsend/main/install.sh | sudo bash -s update\n\n'
  printf '  The password is stored in %s/.env (readable by root only).\n\n' "$DIR"
}

cmd_update() {
  need_root
  [ -f "$DIR/docker-compose.yml" ] || die "No installation found in $DIR"
  IMAGE="$(grep '^HAWARSEND_IMAGE=' "$DIR/.env" | cut -d= -f2-)"
  if [ "$IMAGE" = "hawarsend:local" ] && [ -d "$DIR/src" ]; then
    info "Rebuilding from source"
    git -C "$DIR/src" pull --ff-only
    docker build -t "$IMAGE" "$DIR/src"
  else
    compose pull
  fi
  compose up -d --remove-orphans
  wait_healthy
  docker image prune -f >/dev/null 2>&1 || true
  ok "Updated"
}

cmd_uninstall() {
  need_root
  [ -f "$DIR/docker-compose.yml" ] || die "No installation found in $DIR"
  compose down
  ok "Stopped and removed the containers. Your data is still in $DIR"
}

case "${1:-install}" in
  install) cmd_install ;;
  update) cmd_update ;;
  uninstall) cmd_uninstall ;;
  *) die "Unknown command: $1 (use install, update or uninstall)" ;;
esac
