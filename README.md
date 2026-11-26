<div align="center">
  <img src="public/icon.svg" alt="Hermes Pocket Logo" width="88" height="88" />
  <h1>Hermes Pocket</h1>
  <p>
    <strong>Private, mobile-first Web-App (PWA) für deinen selbst betriebenen Hermes Agent.</strong>
  </p>
  <p>
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=08090c" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
    <img src="https://img.shields.io/badge/PWA-iOS%20%26%20Desktop-f59e0b?style=flat-square" alt="PWA" />
    <img src="https://img.shields.io/badge/Hermes%20Agent-v0.23.4%2B-34d399?style=flat-square" alt="Hermes Agent" />
  </p>
</div>

---

## Überblick

**Hermes Pocket** bringt deine Hermes-Bots, Einzel- und Gruppenchats, Routinen, Connectoren und E-Mail-Integrationen in eine dunkle, auf dem iPhone (und Desktop) schnell bedienbare Oberfläche – vollständig mit eigener Gestaltung und eigenen Ressourcen.

Die bestehende **Hermes-Installation bleibt jederzeit die alleinige Datenquelle** für Profile, Chats, Gruppen, Routinen, Vault-Einträge und Authentifizierung.

## Highlights

- **Chef-Bot & angeheftete Favoriten:** Markiere deinen Haupt-Bot mit einem Tipp als **Chef** (großer Avatar mit Stern-Badge ganz oben) und hefte weitere Favoriten direkt daneben an – synchronisiert über Hermes `ui_meta`.
- **Live-Indikator für neue Bot-Nachrichten:** Ungelesen-Zähler in der Bot-Liste, im Chef-Bereich, in der Tab-Leiste, am Zurück-Button im Chat, als schwebendes In-App-Banner, auf Gruppenkarten sowie als nativer PWA-App-Badge.
- **Wischbare Bild- & Produktkarten bei Websuchen:** Bilder (`![Titel](url)`, direkte Bild-URLs) und Angebotskarten (`[DEAL_CARD: ...]`) erscheinen als nach rechts wischbare Kartenreihe direkt unter der Nachricht – inkl. Vollbild-Lightbox und **„Jetzt kaufen“**-Aktion.
- **1:1-Streaming-Chats & Bot-Komfort:**
  - Live-Streaming (`session.create`, `session.resume`, `prompt.submit`, `session.interrupt`), Tool-Fortschritt, Bild- & Datei-Anhänge.
  - Chat-Befehle (`/model`, `/provider`, `/limit`, `/secret`, `/new`, `/help`), dauerhafte Kontext-/Plan-Limit-Leiste und automatischer Fallback-Anbieter.
  - Interaktive Karten für Rückfragen (`clarify`), Sicherheitsfreigaben, verschlüsselte Tresor-Formulare (`browser_vault`) und Write-Only-`.env`-Geheimnisse.
- **Gruppenchats & Zusammenarbeit:** Erstelle und steuere Hermes-Gruppenräume (`groups.*`) mit Echtzeit-Updates (`groups.changed`) und konfigurierbarem Routing (`auto`, `everyone`, `lead`).
- **Routinen mit Schutzmechanismus:** Übersicht aller Hermes-Cron-Jobs inkl. Zeitplan und Laufhistorie. Aktivieren (`resume`) und manuelles Ausführen (`trigger`) erfordern stets eine ausdrückliche Bestätigung.
- **Privater Bot-Bereich (PIN-geschützt):** Isolierte Bots sind in der normalen Liste, in der Suche, in Gruppen und in öffentlichen Benachrichtigungs-Badges unsichtbar.
- **Native iOS Web Push & Home-Bildschirm-PWA:** Safe-Area-Layout, eigenes App-Manifest, Service Worker für Push-Benachrichtigungen ohne aggressives Bundle-Caching.

## Architektur & Sicherheit

| Schicht | Aufgabe |
| --- | --- |
| **Frontend (`src/`)** | React 19 + TypeScript + Vite PWA mit strikt XSS-sicherem Markdown (`SafeMarkdown`) und sicherer URL-Prüfung. |
| **BFF-Proxy (`server/`)** | Schlanker Node/TypeScript HTTP- & WebSocket-Proxy (Standardport `9135`) mit Pfad-Allowlist, Same-Origin- & `Sec-Fetch-Site`-Prüfung und transparentem Cookie-/WS-Ticket-Passthrough. |
| **Authentifizierung** | Nutzt ausschließlich den bestehenden Hermes-Login (`POST /auth/password-login`, `GET /api/auth/me`, `POST /auth/logout`) über `HttpOnly`-Cookies sowie kurzlebige WebSocket-Einmal-Tickets (`POST /api/auth/ws-ticket`). |
| **Geheimnisse** | Keine Zugangsdaten, Tokens, Cookies, `.env`-Dateien oder persönliche Chatdaten im Repository. Konfiguration erfolgt ausschließlich über lokale, nicht versionierte `.env` (siehe [`.env.example`](.env.example)). |

Ausführliche Betriebs-, Tailscale-Serve- und Sicherheitsdetails findest du in **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**.

## Schnellstart

```bash
cp .env.example .env
# In .env mindestens HERMES_BASE_URL setzen (z. B. http://127.0.0.1:9130)

npm install
npm run typecheck
npm test
npm run build
```

### Lokale Entwicklung

```bash
npm run dev       # Windows (PowerShell/cmd)
npm run dev:unix  # Linux / macOS
```

- **Frontend (Vite Dev):** `http://127.0.0.1:5178`
- **BFF-Proxy:** `http://127.0.0.1:9135`

### Produktionsstart

```bash
npm run build
npm start
```

Auf dem iPhone in Safari öffnen → **Teilen** → **„Zum Home-Bildschirm“** hinzufügen.
