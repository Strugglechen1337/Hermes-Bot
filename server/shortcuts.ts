import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { getPushDataDir, isBotPrivateOnServer, verifyHermesSession } from "./push.js";
import { isSameOriginRequest } from "./security.js";

/**
 * iOS Shortcuts / Siri Integration (`/api/pocket/shortcut`):
 * - Uses a dedicated 32-byte random Bearer token persisted in `.data/shortcut-token` (0600).
 * - Token can only be viewed or rotated by an authenticated Hermes web session.
 * - Private bots are strictly blocked from Siri / Shortcuts execution.
 * - Executes Hermes CLI cleanly via `execFile` (never shell-interpolated).
 */

const SAFE_BOT_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function getShortcutTokenPath(): string {
  return path.join(getPushDataDir(), "shortcut-token");
}

export function getOrCreateShortcutToken(): string {
  const tokenPath = getShortcutTokenPath();
  try {
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, "utf8").trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    // regenerate below
  }
  return rotateShortcutToken();
}

export function rotateShortcutToken(): string {
  const dir = getPushDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString("hex");
  const tokenPath = getShortcutTokenPath();
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

export function verifyShortcutBearer(authHeader: string | undefined): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const candidate = authHeader.slice("Bearer ".length).trim();
  const expected = getOrCreateShortcutToken();
  if (!candidate || candidate.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
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
    if (total > 32 * 1024) throw new Error("BODY_TOO_LARGE");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON");
  }
  return parsed as Record<string, unknown>;
}

function resolveHermesBinary(): string {
  const candidates = [
    process.env.HERMES_BIN?.trim(),
    path.join(os.homedir(), ".local", "bin", "hermes"),
    "/usr/local/bin/hermes",
    "hermes",
  ].filter((x): x is string => Boolean(x));
  for (const bin of candidates) {
    if (bin === "hermes" || fs.existsSync(bin)) return bin;
  }
  return "hermes";
}

function runHermesShortcutPrompt(botName: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = resolveHermesBinary();
    const args = ["chat", "-q", prompt, "--quiet"];
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (botName && botName !== "default") {
      env.HERMES_PROFILE = botName;
    }
    execFile(
      bin,
      args,
      { timeout: 90_000, maxBuffer: 2 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message || "Hermes-Ausführung fehlgeschlagen"));
          return;
        }
        resolve(stdout.trim() || "Erledigt.");
      }
    );
  });
}

export async function handlePocketShortcutRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  pathname: string
): Promise<boolean> {
  if (
    pathname !== "/api/pocket/shortcut" &&
    pathname !== "/api/pocket/shortcut/config" &&
    pathname !== "/api/pocket/shortcut/rotate"
  ) {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();

  // Session-authenticated config & rotation endpoints (for the Account UI)
  if (pathname === "/api/pocket/shortcut/config") {
    if (method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const authed = await verifyHermesSession(req, config);
    if (!authed) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      token: getOrCreateShortcutToken(),
      endpoint: "/api/pocket/shortcut",
    });
    return true;
  }

  if (pathname === "/api/pocket/shortcut/rotate") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (!isSameOriginRequest(req)) {
      sendJson(res, 403, { error: "forbidden_origin" });
      return true;
    }
    const authed = await verifyHermesSession(req, config);
    if (!authed) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }
    sendJson(res, 200, { ok: true, token: rotateShortcutToken() });
    return true;
  }

  // Bearer-authenticated Siri / iOS Shortcuts execution endpoint
  if (method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
  if (!verifyShortcutBearer(authHeader)) {
    sendJson(res, 401, { error: "unauthorized", detail: "Ungültiger Shortcut-Token." });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "bad_request" });
    return true;
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const bot = typeof body.bot === "string" && body.bot.trim() ? body.bot.trim() : "default";
  if (!text || text.length > 4000) {
    sendJson(res, 400, { error: "invalid_prompt", detail: "Bitte einen Text senden." });
    return true;
  }
  if (!SAFE_BOT_RE.test(bot)) {
    sendJson(res, 400, { error: "invalid_bot" });
    return true;
  }
  if (isBotPrivateOnServer(bot)) {
    sendJson(res, 403, { error: "private_bot_blocked", detail: "Private Bots sind für Kurzbefehle gesperrt." });
    return true;
  }

  try {
    const reply = await runHermesShortcutPrompt(bot, text);
    sendJson(res, 200, { ok: true, bot, reply });
  } catch (err) {
    sendJson(res, 502, {
      error: "hermes_failed",
      detail: err instanceof Error ? err.message : "Anfrage an Hermes fehlgeschlagen.",
    });
  }
  return true;
}
