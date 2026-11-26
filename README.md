# Hermes Pocket

Private, mobile-first Web-App (PWA) für einen selbst betriebenen Hermes Agent.

## Ziel

Benannte Bots, Einzel- und Gruppenchats, Routinen und E-Mail-Integrationen in einer auf dem iPhone gut bedienbaren, dunklen Oberfläche – mit eigener Gestaltung und eigenen Ressourcen. Die bestehende Hermes-Installation bleibt die alleinige Quelle für Profile, Chats, Gruppen, Routinen und Authentifizierung.

## Funktionsumfang (MVP)

- **Hermes-Anmeldung:** Nutzt die bestehende Hermes-Weboberflächen-Anmeldung (`POST /auth/password-login`, `GET /api/auth/me`, `POST /auth/logout`) über `HttpOnly`-Cookies sowie sitzungsgebundene WebSocket-Einmal-Tickets (`POST /api/auth/ws-ticket`).
- **Bots & 1:1-Chats:** Zeigt alle realen Hermes-Profile (inkl. Modell, Gateway-Status und letzter Session) und unterstützt Streaming-Chats (`session.create`, `session.resume`, `prompt.submit`, `session.interrupt`, Tool-Fortschritt und Freigabe-Rückfragen).
- **Gruppenchats & Zusammenarbeit:** Erstellt und verwaltet Hermes-Gruppenräume (`groups.capabilities`, `groups.list`, `groups.create`, `groups.state`, `groups.log`, `groups.send`, `groups.context`, `groups.stop`, `groups.disband`) mit Echtzeit-Updates über `groups.changed`.
- **Routinen:** Listet alle Hermes-Cron-Jobs inkl. Status (`Pausiert` / `Aktiv`), Zeitplan und Laufhistorie. Aktivieren und manuelles Starten erfordern stets eine ausdrückliche Bestätigung.
- **E-Mail-Integration:** Zeigt den realen Status der Hermes-E-Mail-Plattform pro Profil, erlaubt sichere Einrichtung direkt in Hermes sowie explizite Verbindungstests.
- **iPhone-PWA:** Dunkles Mobile-First-Layout mit Safe-Area-Unterstützung, Web-App-Manifest und eigenen App-Icons für „Zum Home-Bildschirm“.

## Architektur und Sicherheit

- **Frontend:** React + TypeScript + Vite PWA (`src/`).
- **BFF-Proxy:** Schlanker Node/TypeScript HTTP- & WebSocket-Proxy (`server/`) mit strikter Pfad-Allowlist, Same-Origin-Prüfung und transparentem Cookie-/WS-Ticket-Passthrough.
- **Keine Secrets in Git:** Serveradresse und Ports werden ausschließlich über lokale, nicht versionierte `.env` konfiguriert (siehe [.env.example](.env.example)).
- Details zu Betrieb, Tailscale-Serve-Integration und Sicherheitsannahmen stehen in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Schnellstart

```bash
cp .env.example .env
npm install
npm run typecheck
npm test
npm run build
```
