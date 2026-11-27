#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Hermes Bots — Safe Auto-Updater
# Pulls latest release from main, rebuilds, and restarts the user service
# WITHOUT touching .env, .data/, Hermes profiles, or routines.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$APP_DIR"

echo "🔄  Checking for Hermes Bots updates in $APP_DIR..."
git fetch --tags origin

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "✅  Already up to date ($(node -p "require('./package.json').version"))."
  exit 0
fi

echo "⬇️   Updating $LOCAL_SHA -> $REMOTE_SHA..."
git pull --ff-only origin main

echo "📦  Installing dependencies..."
npm ci

echo "🔨  Building web PWA & server..."
npm run build

# Restart whichever systemd user service is installed
if command -v systemctl >/dev/null 2>&1; then
  for svc in hermes-bots.service hermes-pocket.service; do
    if systemctl --user list-unit-files "$svc" >/dev/null 2>&1 && systemctl --user is-enabled "$svc" >/dev/null 2>&1; then
      echo "🔁  Restarting $svc..."
      systemctl --user restart "$svc"
      sleep 1
      systemctl --user is-active "$svc"
      break
    fi
  done
fi

NEW_VER="$(node -p "require('./package.json').version")"
echo "✅  Hermes Bots updated cleanly to v${NEW_VER}!"
