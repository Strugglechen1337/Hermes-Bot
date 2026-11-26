# Gemeinsamer Projektstand

## Gewünschtes Ergebnis

Eine auf dem iPhone gut bedienbare private Web-App (PWA) für Hermes: Bot-Liste, Einzel- und Gruppenchats, Routinen und E-Mails. Visuelle Orientierung: einfache, dunkle Oberfläche; komplett eigene Umsetzung und eigene Ressourcen.

## Vorhandene Infrastruktur (abgeglichen)

- Bestehender Hermes-Server läuft mit **Hermes Agent v0.23.4** (`hermes gateway run`, FastAPI/Uvicorn lokal auf Loopback-Port `9130`, privat über Tailscale Serve mit HTTPS erreichbar).
- Verifizierte Authentifizierung: bestehender Passwort-Login (`POST /auth/password-login` mit Provider `basic`), `HttpOnly`-Session-Cookies, Identitätsprüfung (`GET /api/auth/me`), Abmeldung (`POST /auth/logout`) sowie 30s-Einmal-WebSocket-Tickets (`POST /api/auth/ws-ticket` → `/api/ws?ticket=...`).
- Verifizierte Schnittstellen:
  - **REST:** `/api/status`, `/api/profiles`, `/api/sessions`, `/api/sessions/{id}/messages`, `/api/cron/jobs`, `/api/cron/jobs/{id}/runs`, `/api/cron/jobs/{id}/(pause|resume|trigger)`, `/api/messaging/platforms`, `/api/messaging/platforms/{id}` und `/test`.
  - **WebSocket JSON-RPC 2.0 (`/api/ws`):** `session.create`, `session.resume`, `prompt.submit`, `session.interrupt`, `approval.respond`, `gateway.ping` sowie Gruppen-RPCs (`groups.capabilities`, `groups.list`, `groups.create`, `groups.state`, `groups.log`, `groups.send`, `groups.context`, `groups.stop`, `groups.disband`) inkl. Live-Events (`message.delta`, `message.complete`, `reasoning.delta`, `tool.progress`, `groups.changed`).
- Mehrere produktive Hermes-Profile sind vorhanden (u. a. `mika`, `default` und weitere Fach-Bots).
- Mika: Rolle und exportierte Erinnerungen sind im Hermes-Profil `mika` vorhanden; die importierte Mail-Routine bleibt **pausiert**, bis E-Mail-Zugang und Zustellung explizit geprüft und freigegeben sind.
- Konkrete Serveradressen, Benutzernamen und Zugangsdaten werden **nicht** im Repository gespeichert (nur lokale `.env`).

## Aktueller Umsetzungsstand (`feat/hermes-pocket-mvp`)

1. **Schnittstellen & Authentifizierung (erledigt):** Gegen die reale Hermes-Installation v0.23.4 geprüft (rein lesend, ohne bestehende Dienste zu beeinflussen).
2. **BFF-Proxy & WebSocket-Bridge (erledigt):** Schlanker Node/TypeScript-Server (`server/`, Standardport `9135`) mit Pfad-Allowlist, Same-Origin-Schutz, Cookie-Passthrough, sitzungsgebundener WS-Ticket-Bridge sowie eng validierten BFF-Endpunkten für Profil-Fallbacks (`/api/pocket/fallback`) und Write-Only-Geheimnisspeicherung (`/api/pocket/secret`).
3. **Mobile-first PWA (erledigt):** React + TypeScript Oberfläche (`src/`) im dunklen Design mit eigenen Icons (`public/icon.svg`, `icon-180.png`, `icon-512.png`), Web-App-Manifest, Chef-/Anheften-Showcase oben in der Bot-Liste, Echtzeit- & Hintergrund-Indikatoren für neue Bot- und Gruppennachrichten (inkl. Tab-Badges, Zurück-Badge, Floating-Toast und PWA-App-Badge), Bots/1:1-Streaming-Chat (inkl. Bild- & Datei-Anhängen, wischbarer Bild- und Produktkarten-Galerie bei Websuchen inkl. Lightbox, `/model`/`/provider`/`/limit`/`/secret`-Chatbefehlen, Grok-Bot-Import, dauerhaft sichtbarer Chat-/Plan-Limit-Leiste, automatischem Anthropic-Fallback für alle Bots, interaktiven Klick-Boxen für Rückfragen/Freigaben/Passwörter/API-Keys/Tresor sowie Tastatur-Autoscroll zur letzten Nachricht), Gruppenchats, privatem PIN-Bereich, iOS Web Push, Routinen (mit Sicherheits-Bestätigung vor Aktivierung/Auslösung) und Connectoren/E-Mail.
4. **Tests & Dokumentation (erledigt):** 61 automatisierte Tests (15 Testdateien) für BFF-Sicherheit, Proxy-Verhalten, Ungelesen-Erkennung, Chef-/Pin-Logik, Usage-/Limit-Auswertung, interaktive Chat-Prompt-Karten, Bot-Import-Parser, XSS-sicheres Markdown inkl. Websuch-Bildkarussell und Routinen-Schutzmechanismen sowie Betriebsdokumentation in `docs/DEPLOYMENT.md`.
5. **Privates Hosting & iPhone-Zugang (erledigt):** Als eigener `systemd`-User-Service (`hermes-pocket.service`) auf Loopback-Port `127.0.0.1:9135` (mit `COOKIE_SECURE=true`) eingerichtet und über einen eigenen privaten Tailscale-Serve-HTTPS-Port (`8444`) bereitgestellt. Bestehende Dienste und der bestehende Hermes-Webzugang (`9130` / `8443`) blieben vollständig unangetastet.

## Offene Arbeit

1. Live-Prüfung am iPhone (Login mit bestehendem Hermes-Konto, Bot-Chat mit `mika`, Gruppenchat, Routinen-Ansicht sowie „Zum Home-Bildschirm“).
2. E-Mail-Zugang für `mika` im Tab „E-Mail“ bewusst einrichten und testen; erst nach erfolgreicher Verifikation die pausierte Mail-Routine freigeben.

## Zusammenarbeit

Je Aufgabe eigenen Branch und nach Möglichkeit eigenen Git-Worktree nutzen. Vor der Übergabe Änderungen committen oder den uncommitteten Zustand klar mitteilen. Keine Branches anderer Personen zurücksetzen, keine unaufgeforderten Pushes oder Veröffentlichungen. Bei Entscheidungen oder Änderungen an der Infrastruktur das Ergebnis hier aktualisieren.
