# Betrieb & Sicherheit (Hermes Pocket)

## Sicherheits- und Zugriffsannahmen

1. **Keine Umgehung der Hermes-Authentifizierung:**
   - Hermes Pocket nutzt ausschließlich die vorhandene Anmeldung des Hermes-Webservers (`POST /auth/password-login`, `GET /api/auth/me`, `POST /auth/logout`).
   - Session-Cookies bleiben `HttpOnly` und `SameSite=Lax` (unter HTTPS zusätzlich `Secure`). Passwörter, Tokens oder Cookies werden weder in `localStorage` noch im Repository oder in Logs gespeichert.
   - WebSocket-Verbindungen (`/api/ws`) beziehen für jede Verbindung ein kurzlebiges, sitzungsgebundenes Einmal-Ticket über `POST /api/auth/ws-ticket` auf dem Hermes-Server. Nach einer Abmeldung werden zugehörige WebSockets von Hermes automatisch beendet.

2. **Eingeschränkter BFF-Proxy statt offenem Reverse-Proxy:**
   - Der Node/TypeScript-BFF-Server (`server/`) leitet ausschließlich eine fest definierte Allowlist dokumentierter Hermes-Pfade weiter (Auth, Profile, Sessions, Routinen/Cron, Messaging/E-Mail).
   - Alle schreibenden HTTP-Anfragen sowie WebSocket-Upgrades werden per Same-Origin- und `Sec-Fetch-Site`-Prüfung abgesichert.

3. **Schutz produktiver Routinen & E-Mail-Konten:**
   - Routinen werden niemals automatisch aktiviert oder ausgelöst. Aktivieren (`resume`) und manuelles Ausführen (`trigger`) erfordern in der Oberfläche eine ausdrückliche Bestätigung mit Warnhinweis.
   - E-Mail-Zugangsdaten werden direkt an die Hermes-Messaging-API übergeben, dort gespeichert und im UI nur geschwärzt (`redacted_value`) angezeigt.

## Lokale Entwicklung

```bash
cp .env.example .env
# In .env HERMES_BASE_URL setzen (z. B. http://127.0.0.1:9130 per SSH-Tunnel oder Tailscale-HTTPS-URL)
npm install
npm run dev       # Windows (PowerShell/cmd)
# bzw. npm run dev:unix auf Linux/macOS
```

- Frontend (Vite Dev): `http://127.0.0.1:5178`
- BFF-Proxy: `http://127.0.0.1:9135`

## Privater Betrieb auf dem Hermes-Server (ohne bestehende Dienste zu stören)

Der bestehende Hermes-Webserver (Standard-Loopback-Port `9130` bzw. Tailscale-Serve-Port) bleibt vollständig unverändert. Hermes Pocket läuft parallel auf einem eigenen freien Loopback-Port (Standard: `127.0.0.1:9135`).

1. **Build erstellen:**
   ```bash
   npm ci
   npm run build
   ```
2. **Lokale `.env` auf dem Server anlegen (nicht in Git):**
   ```env
   HERMES_BASE_URL=http://127.0.0.1:9130
   HOST=127.0.0.1
   PORT=9135
   COOKIE_SECURE=true
   ```
3. **Optional als eigener `systemd`-User-Service (`~/.config/systemd/user/hermes-pocket.service`):**
   ```ini
   [Unit]
   Description=Hermes Pocket Mobile Web UI
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/pfad/zu/hermes-pocket
   ExecStart=/pfad/zu/node dist-server/server/index.js
   Restart=on-failure
   RestartSec=3

   [Install]
   WantedBy=default.target
   ```
4. **Privater iPhone-Zugriff über Tailscale Serve (eigener HTTPS-Port, z. B. `8444`):**
   ```bash
   tailscale serve --bg --https=8444 http://127.0.0.1:9135
   ```
   Dadurch bleibt die bestehende Hermes-Weboberfläche auf ihrem bisherigen Port vollständig erreichbar.
   Auf dem iPhone in Safari öffnen → **Teilen** → **Zum Home-Bildschirm** hinzufügen.
