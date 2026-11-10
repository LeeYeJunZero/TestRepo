#!/usr/bin/env bash
# Ubuntu 22.04/24.04 서버 최초 설치 스크립트 (root 로 실행)
#   사용법: sudo bash setup-ubuntu.sh [도메인] [git 저장소 URL]
set -euo pipefail
DOMAIN="${1:-firstteacher.co.kr}"
REPO="${2:-https://github.com/LeeYeJunZero/TestRepo.git}"
APP=/opt/tutor-sites

apt-get update
apt-get install -y curl git debian-keyring debian-archive-keyring apt-transport-https gnupg

# Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# 앱
id tutor &>/dev/null || useradd --system --home "$APP" --shell /usr/sbin/nologin tutor
[ -d "$APP/.git" ] || git clone "$REPO" "$APP"
cd "$APP" && git pull --ff-only && npm ci --omit=dev
mkdir -p "$APP/data"
if [ ! -f "$APP/.env" ]; then
  PW=$(openssl rand -base64 18)
  cat > "$APP/.env" <<ENV
PORT=3000
NODE_ENV=production
SITE_DOMAIN=$DOMAIN
ADMIN_PASSWORD=$PW
SESSION_SECRET=$(openssl rand -hex 32)
DATA_DIR=$APP/data
CORS_ORIGINS=https://leeyejunzero.github.io
ENV
  echo "★ 어드민 비밀번호: $PW   ($APP/.env 에서 변경 가능)"
fi
chown -R tutor:tutor "$APP"
chmod 600 "$APP/.env"

cp "$APP/deploy/tutor-sites.service" /etc/systemd/system/
sed "s/firstteacher.co.kr/$DOMAIN/g" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now tutor-sites
systemctl reload caddy || systemctl restart caddy

# 방화벽 (ufw 사용 시)
command -v ufw >/dev/null && ufw allow 80,443/tcp || true
echo "완료: https://admin.$DOMAIN"
