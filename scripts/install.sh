#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Hermes Bots — 1-Line Installer (Linux / macOS)
# Official Repo: https://github.com/Strugglechen1337/Hermes-Pocket-
#
# Recommended Network Setup: Tailscale Serve (tailnet-only HTTPS, zero open ports)
# ==============================================================================

REPO_URL="${HERMES_BOTS_REPO_URL:-https://github.com/Strugglechen1337/Hermes-Pocket-.git}"
INSTALL_DIR="${HERMES_BOTS_DIR:-$HOME/hermes-bots}"
PORT="${PORT:-9135}"
HERMES_BASE_URL="${HERMES_BASE_URL:-http://127.0.0.1:9130}"
SERVICE_NAME="hermes-bots.service"

echo ""
echo "🤖  Hermes Bots Installer"
echo "    Private mobile PWA for your self-hosted Hermes Agent"
echo ""

# 1. Check prerequisites
if ! command -v git >/dev/null 2>&1; then
  echo "❌  git is required. Please install git first."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌  Node.js 20+ is required. Install from https://nodejs.org or via nvm."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌  Node.js 20+ required (found $(node -v))."
  exit 1
fi

echo "✅  Node.js $(node -v) & git detected"

# 2. Clone or update repository (never overwrites .env or .data/)
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "🔄  Existing installation found in $INSTALL_DIR — updating..."
  git -C "$INSTALL_DIR" fetch --tags origin
  git -C "$INSTALL_DIR" pull --ff-only origin main
else
  echo "📦  Cloning Hermes Bots into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# 3. Install dependencies & build
echo "📦  Installing dependencies..."
npm ci

echo "🔨  Building web PWA & BFF server..."
npm run build

# 4. Create .env only if missing
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<EOF
HOST=127.0.0.1
PORT=${PORT}
HERMES_BASE_URL=${HERMES_BASE_URL}
COOKIE_SECURE=auto
EOF
  chmod 600 "$INSTALL_DIR/.env"
  echo "✅  Created $INSTALL_DIR/.env (bound strictly to 127.0.0.1:${PORT})"
else
  echo "ℹ️   Keeping existing $INSTALL_DIR/.env untouched"
fi

# 5. Set up systemd --user auto-start on Linux (survives reboots)
if command -v systemctl >/dev/null 2>&1 && [ "$(uname -s)" = "Linux" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  NODE_BIN="$(command -v node)"
  cat > "$UNIT_DIR/$SERVICE_NAME" <<EOF
[Unit]
Description=Hermes Bots Private Mobile PWA
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${NODE_BIN} ${INSTALL_DIR}/dist-server/server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"
  echo "✅  systemd user service '$SERVICE_NAME' enabled and started"

  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USER" 2>/dev/null || true
    echo "✅  Enabled lingering so Hermes Bots auto-starts after server reboot"
  fi
fi

# 6. Tailscale recommendation
echo ""
echo "=============================================================================="
echo "🎉  Hermes Bots is running locally at http://127.0.0.1:${PORT}"
echo ""
echo "🔒  STRONGLY RECOMMENDED — Expose privately with Tailscale Serve (HTTPS):"
echo "    tailscale serve --bg --https=8444 http://127.0.0.1:${PORT}"
echo ""
echo "    Why Tailscale?"
echo "    • Automatic HTTPS certificate (required for iOS PWA & Web Push)"
echo "    • Zero open ports on your router / firewall"
echo "    • Only reachable from your own private devices (iPhone, iPad, Mac, PC)"
echo ""
echo "🔄  To update anytime without losing data:"
echo "    cd ${INSTALL_DIR} && bash scripts/update.sh"
echo "=============================================================================="
