#!/usr/bin/env bash
# 코드 업데이트: sudo bash /opt/tutor-sites/deploy/update.sh
set -euo pipefail
cd /opt/tutor-sites
sudo -u tutor git pull --ff-only
sudo -u tutor npm ci --omit=dev
systemctl restart tutor-sites
systemctl status tutor-sites --no-pager -l | head -5
