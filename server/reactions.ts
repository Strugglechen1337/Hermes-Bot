import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { getPushDataDir, verifyHermesSession } from "./push.js";
import { isSameOriginRequest } from "./security.js";

/**
 * Per-session message reactions (👍 ❤️ 😂 🔥 ✅) persisted on the server
 * (`.data/reactions.json`, mode 0600) so likes sync across devices.
 */

const ALLOWED_EMOJIS = new Set(["👍", "❤️", "😂", "🔥", "✅", "🙏", "🎉"]);
const SESSION_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

// Map: sessionId -> msgKey -> array of emojis
type ReactionsFile = Record<string, Record<string, string[]>>;

function getReactionsPath(): string {
  return path.join(getPushDataDir(), "reactions.json");
}

function loadAll(): ReactionsFile {
  const filePath = getReactionsPath();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as ReactionsFile;
      }
    }
  } catch {
    // ignore corrupt file
  }
  return {};
}

function saveAll(data: ReactionsFile): void {
  const dir = getPushDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = getReactionsPath();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

export function getSessionReactions(sessionId: string): Record<string, string[]> {
  if (!SESSION_KEY_RE.test(sessionId)) return {};
  return loadAll()[sessionId] || {};
}

export function toggleReaction(
  sessionId: string,
  msgKey: string,
  emoji: string
): Record<string, string[]> {
  if (!SESSION_KEY_RE.test(sessionId)) return {};
  const cleanKey = msgKey.trim().slice(0, 128);
  const cleanEmoji = emoji.trim();
  if (!cleanKey || !ALLOWED_EMOJIS.has(cleanEmoji)) {
    return getSessionReactions(sessionId);
  }

  const all = loadAll();
  const sess = { ...(all[sessionId] || {}) };
  const current = Array.isArray(sess[cleanKey]) ? sess[cleanKey] : [];
  const next = current.includes(cleanEmoji)
    ? current.filter((e) => e !== cleanEmoji)
    : [...current, cleanEmoji];

  if (next.length > 0) {
    sess[cleanKey] = next;
  } else {
    delete sess[cleanKey];
  }

  all[sessionId] = sess;
  // Cap total tracked sessions at 200
  const keys = Object.keys(all);
  if (keys.length > 200) {
    for (const oldKey of keys.slice(0, keys.length - 200)) {
      delete all[oldKey];
    }
  }
  saveAll(all);
  return sess;
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 16 * 1024) throw new Error("BODY_TOO_LARGE");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export async function handlePocketReactionsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith("/api/pocket/reactions/")) {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "PUT") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  if (method === "PUT" && !isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin" });
    return true;
  }

  const authed = await verifyHermesSession(req, config);
  if (!authed) {
    sendJson(res, 401, { error: "unauthorized" });
    return true;
  }

  const sessionId = decodeURIComponent(pathname.slice("/api/pocket/reactions/".length)).trim();
  if (!SESSION_KEY_RE.test(sessionId)) {
    sendJson(res, 400, { error: "invalid_session" });
    return true;
  }

  if (method === "GET") {
    sendJson(res, 200, { ok: true, reactions: getSessionReactions(sessionId) });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "bad_request" });
    return true;
  }

  const msgKey = typeof body.msgKey === "string" ? body.msgKey : "";
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  if (!msgKey || !ALLOWED_EMOJIS.has(emoji)) {
    sendJson(res, 400, { error: "invalid_reaction" });
    return true;
  }

  const updated = toggleReaction(sessionId, msgKey, emoji);
  sendJson(res, 200, { ok: true, reactions: updated });
  return true;
}
