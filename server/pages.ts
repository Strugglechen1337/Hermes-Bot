import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import { getPushDataDir, verifyHermesSession } from "./push.js";

/**
 * Pocket Pages: bot-generated, self-contained HTML pages (e.g. daily briefings,
 * reports, dashboards) that bots publish locally via `bin/publish-page` and
 * reference in chat with `[POCKET_PAGE: id | Titel | Kurzbeschreibung]`.
 *
 * Security model:
 * - Pages are only served to an authenticated Hermes session (same cookie check as push).
 * - Every page is served with a CSP `sandbox` (without `allow-same-origin`), so page
 *   scripts run in an opaque origin and can never read Hermes Pocket cookies, storage,
 *   or call the authenticated BFF API.
 * - Page IDs are strictly validated; no path traversal is possible.
 */

export const PAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;

export function getPagesDir(): string {
  return path.join(getPushDataDir(), "pages");
}

export interface PocketPageMeta {
  id: string;
  title: string;
  summary: string;
  bot: string;
  createdAt: number;
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readMeta(id: string): PocketPageMeta | null {
  try {
    const raw = fs.readFileSync(path.join(getPagesDir(), `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      id,
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 160) : id,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "",
      bot: typeof parsed.bot === "string" ? parsed.bot.slice(0, 64) : "",
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export const PAGE_CSP = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  "default-src 'none'",
  "img-src https: data:",
  "media-src https: data:",
  "style-src 'unsafe-inline' https:",
  "font-src https: data:",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

export async function handlePocketPagesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  pathname: string
): Promise<boolean> {
  if (pathname !== "/api/pocket/pages" && !pathname.startsWith("/api/pocket/pages/")) {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const authenticated = await verifyHermesSession(req, config);
  if (!authenticated) {
    sendJson(res, 401, { error: "unauthorized", detail: "Anmeldung bei Hermes erforderlich." });
    return true;
  }

  // List recent pages (metadata only)
  if (pathname === "/api/pocket/pages") {
    let entries: PocketPageMeta[] = [];
    try {
      entries = fs
        .readdirSync(getPagesDir())
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .filter((id) => PAGE_ID_PATTERN.test(id))
        .map((id) => readMeta(id))
        .filter((m): m is PocketPageMeta => m !== null)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50);
    } catch {
      entries = [];
    }
    sendJson(res, 200, { ok: true, pages: entries });
    return true;
  }

  const rest = pathname.slice("/api/pocket/pages/".length);
  const isMetaRequest = rest.endsWith("/meta");
  const id = isMetaRequest ? rest.slice(0, -"/meta".length) : rest;
  if (!PAGE_ID_PATTERN.test(id)) {
    sendJson(res, 404, { error: "not_found" });
    return true;
  }

  if (isMetaRequest) {
    const meta = readMeta(id);
    if (!meta) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    sendJson(res, 200, { ok: true, page: meta });
    return true;
  }

  const htmlPath = path.join(getPagesDir(), `${id}.html`);
  if (!fs.existsSync(htmlPath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Seite nicht gefunden.");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": PAGE_CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
  });
  if (method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(htmlPath).pipe(res);
  return true;
}
