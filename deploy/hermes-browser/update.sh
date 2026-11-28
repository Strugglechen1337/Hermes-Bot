#!/usr/bin/env bash
# Weekly update of the shared bot browser. Keeps the previous image and rolls back if the new one fails.
set -u
cd "$(dirname "$0")"
IMG=lscr.io/linuxserver/chromium:latest
log() { echo "$(date -Is) $*"; }
healthy() {
  for _ in $(seq 1 12); do
    sleep 5
    curl -fs http://127.0.0.1:9223/json/version >/dev/null 2>&1 \
      && [ "$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3000/)" = "401" ] && return 0
  done
  return 1
}
old=$(docker image inspect -f "{{.Id}}" "$IMG" 2>/dev/null || true)
[ -n "$old" ] && docker tag "$IMG" hermes-browser-previous
docker compose pull -q || { log "pull failed, keeping current"; exit 0; }
new=$(docker image inspect -f "{{.Id}}" "$IMG")
if [ "$old" = "$new" ]; then log "already up to date"; docker image prune -f >/dev/null; exit 0; fi
log "updating $old -> $new"
docker compose up -d
if healthy; then log "update ok"; docker image prune -f >/dev/null
else
  log "new image unhealthy, rolling back"
  docker tag hermes-browser-previous "$IMG"
  docker compose up -d --force-recreate
  healthy && log "rollback ok" || log "ROLLBACK FAILED"
fi
