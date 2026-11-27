# PROJECT.md — Hermes Bots (formerly Hermes Pocket)

Current Status: **v2.0.0 — Production Live & Active**  
Repository: `https://github.com/Strugglechen1337/Hermes-Bot` (branch `main` / `feat/hermes-pocket-mvp`)

## Architecture Overview

- **Frontend:** React 18 + TypeScript + Vite PWA (`src/`), dark-first mobile UI inspired by modern bot messengers (100% original design & assets).
  - Entry & shell: `src/App.tsx` (responsive 2-column split-screen for `>= 740px` & foldable / iPhone Duo `@media (horizontal-viewport-segments: 2)`).
  - Core views:
    - `src/components/BotsView.tsx` — Chief/Pinned showcase, bot list with unread badges, drafts (`Entwurf:`), pull-to-refresh, global message search.
    - `src/components/DirectChatView.tsx` — 1:1 bot chat, streaming with live German activity hints (`sucht im Web…`, `erstellt Bild…`, etc.), mid-stream follow-up sending, local Whisper voice input, German TTS Read-Aloud (`src/lib/tts.ts`), bidirectional emoji reactions (`👍 ❤️ 😂 🔥 ✅` + bot `[REACT: ...]` directives), message bookmarks, per-bot quick prompts, in-chat search, long-press message menu (Reply/Copy/Read-Aloud/Bookmark/Share/Forward), inline media (`MEDIA:/...`), Markdown pipe tables/headings/ordered lists/favicon link chips, interactive checklists (`[CHECKLIST: ...]`), package tracking cards (`[PACKAGE_CARD: ...]`), deal carousels (`[DEAL_CARD: ...]`), and sandboxed briefings (`[POCKET_PAGE: ...]`). Internal `tool`-call pills, empty reasoning-only bubbles, bot-to-bot DM chatter, and Hermes gateway noise (`[ASYNC DELEGATION ...]`, `[INTERNAL NOTIFICATION ...]`, `[Cronjob ... output]`) are filtered out.
    - `src/components/GroupsView.tsx` — Multi-bot group rooms with Reply/Copy/Share, local Whisper voice input, edge swipe-back, briefings, and package cards.
    - `src/components/RoutinesView.tsx` — Hermes cron routines with explicit safety guardrails (paused routines remain paused unless explicitly confirmed).
    - `src/components/ConnectorsView.tsx` — Hosted OAuth connectors (Gmail, Google Calendar, GitHub, etc.), 1-step Gmail/Outlook App-Password IMAP/SMTP setup (`EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `EMAIL_IMAP_HOST`, `EMAIL_SMTP_HOST`), MCP servers with OAuth polling, and direct Home Assistant (`HASS_URL` / `HASS_TOKEN`) setup.
    - `src/components/AiProvidersSheet.tsx` — Write-only API key setup for 9+ top AI providers (OpenAI, Anthropic, Google Gemini, xAI Grok, OpenRouter, DeepSeek, Mistral, Groq, Ollama).
    - `src/components/BookmarksSheet.tsx`, `src/components/BotMediaGallerySheet.tsx` & `src/components/PagesArchiveSheet.tsx` — Cross-device message bookmarks, per-bot media gallery, & Briefings archive.
- **Backend (BFF Proxy):** Node.js 20+ TypeScript HTTP/WS proxy (`server/`), bound strictly to `127.0.0.1:9135` behind Tailscale Serve (`:8444`, tailnet-only HTTPS).
  - `server/proxy.ts` & `server/security.ts` — Allowlisted HTTP/WS proxy to Hermes Agent (`127.0.0.1:9130`, 65s timeout for messaging/MCP reloads), Same-Origin enforcement, profile `ui_meta` disk hydration (`chief`, `pinned`, `private`).
  - `server/push.ts` & `server/pushWatcher.ts` — Web Push (VAPID), master & per-bot switches, hard server-side block for private bots, foreground presence heartbeat (`/api/pocket/push/presence`), and a read-only SQLite watcher across all Hermes profiles AND hosted group rooms (`hosted_room_events`) for reliable iOS background pushes with deep-linking.
  - `server/bookmarks.ts` — Persisted cross-device message bookmarks (`/api/pocket/bookmarks`, private bots excluded).
  - `server/reactions.ts` — Persisted per-session message reactions (`/api/pocket/reactions/:sessionId`).
  - `server/pages.ts` — Sandboxed HTML briefings (`/api/pocket/pages/*`, CSP sandbox without `allow-same-origin`).
  - `server/media.ts` — Authenticated `MEDIA:/...` file streaming & gallery listing with strict path/extension allowlists.
  - `server/transcribe.ts` & `bin/stt-worker.py` — Warm local `faster-whisper` (`base`, int8, 4 CPU threads, ffmpeg PCM decode) with fallback to Hermes `/api/audio/transcribe`.
  - `server/preferences.ts` — Multi-device sync for `hiddenProfiles`, hashed `vaultPinHash`, and per-bot `quickPrompts`.
  - `server/checklists.ts` — Persisted interactive checklists (`/api/pocket/checklists/:id`).
  - `server/shortcuts.ts` — Dedicated Bearer-token iOS Siri Shortcuts endpoint (`/api/pocket/shortcut`, private bots hard-blocked).
  - `server/updater.ts` — GitHub Releases version check (`/api/pocket/update-check`).
- **Install & Update Scripts:** `scripts/install.sh` (1-line installer with systemd auto-start & Tailscale guide) and `scripts/update.sh` (safe zero-data-loss updater).

## Key Conventions for All Agents (Codex, Claude, Antigravity)
- Hermes Agent remains the sole source of truth for auth, bots, chats, groups, and routines.
- **Home Assistant:** Always use `HASS_TOKEN` and `HASS_URL` (never `SERVICE_TOKEN` or `HOME_ASSISTANT_TOKEN`).
- **Security:** NEVER commit `.env`, `.data/`, credentials, tokens, private bot names, personal messages, or private coordinates/addresses (this GitHub repository is **public**).
- **Verification:** Always run `npm run typecheck`, `npm test`, and `npm run build` before deploying or pushing.
