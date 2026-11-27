import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import { getPushDataDir, isBotPrivateOnServer, verifyHermesSession } from "./push.js";
import { isSameOriginRequest } from "./security.js";

export interface SavedBookmark {
  id: string;
  bot: string;
  author: string;
  text: string;
  sessionId?: string;
  createdAt: number;
}

const MAX_BOOKMARKS = 200;

function getBookmarksPath(): string {
  return path.join(getPushDataDir(), "bookmarks.json");
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage, maxBytes = 32 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("BODY_TOO_LARGE");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function loadBookmarks(): SavedBookmark[] {
  const filePath = getBookmarksPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is SavedBookmark =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as SavedBookmark).id === "string" &&
        typeof (item as SavedBookmark).text === "string"
    );
  } catch {
    return [];
  }
}

function saveBookmarks(items: SavedBookmark[]): void {
  const dir = getPushDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(getBookmarksPath(), JSON.stringify(items.slice(0, MAX_BOOKMARKS), null, 2), {
    mode: 0o600,
  });
}

export async function handlePocketBookmarksRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  pathname: string
): Promise<boolean> {
  if (pathname !== "/api/pocket/bookmarks" && !pathname.startsWith("/api/pocket/bookmarks/")) {
    return false;
  }

  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin" });
    return true;
  }

  const authenticated = await verifyHermesSession(req, config);
  if (!authenticated) {
    sendJson(res, 401, { error: "unauthorized" });
    return true;
  }

  const method = (req.method || "GET").toUpperCase();

  if (pathname === "/api/pocket/bookmarks" && method === "GET") {
    const items = loadBookmarks().filter((b) => !b.bot || !isBotPrivateOnServer(b.bot));
    sendJson(res, 200, { ok: true, bookmarks: items });
    return true;
  }

  if (pathname === "/api/pocket/bookmarks" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "bad_request" });
      return true;
    }

    const bot = typeof body.bot === "string" ? body.bot.trim().slice(0, 64) : "";
    const author = typeof body.author === "string" ? body.author.trim().slice(0, 64) : bot || "Bot";
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim().slice(0, 128) : undefined;

    if (!text) {
      sendJson(res, 400, { error: "invalid_text" });
      return true;
    }
    if (bot && isBotPrivateOnServer(bot)) {
      sendJson(res, 403, { error: "private_bot_blocked" });
      return true;
    }

    const items = loadBookmarks();
    const existing = items.find((b) => b.bot === bot && b.text === text);
    if (existing) {
      sendJson(res, 200, { ok: true, bookmark: existing, duplicate: true });
      return true;
    }

    const created: SavedBookmark = {
      id: `bm_${crypto.randomBytes(6).toString("hex")}`,
      bot,
      author,
      text,
      ...(sessionId ? { sessionId } : {}),
      createdAt: Date.now(),
    };
    const next = [created, ...items].slice(0, MAX_BOOKMARKS);
    saveBookmarks(next);
    sendJson(res, 201, { ok: true, bookmark: created });
    return true;
  }

  if (pathname.startsWith("/api/pocket/bookmarks/") && method === "DELETE") {
    const id = decodeURIComponent(pathname.slice("/api/pocket/bookmarks/".length)).trim();
    if (!id) {
      sendJson(res, 400, { error: "invalid_id" });
      return true;
    }
    const items = loadBookmarks();
    const next = items.filter((b) => b.id !== id);
    saveBookmarks(next);
    sendJson(res, 200, { ok: true, removed: items.length - next.length });
    return true;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
  return true;
}
