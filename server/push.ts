import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as webpushNs from "web-push";
import type { ServerConfig } from "./config.js";
import { isSameOriginRequest } from "./security.js";

const webpush =
  (webpushNs as unknown as { default?: typeof webpushNs }).default ?? webpushNs;

export interface StoredPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: number;
  userAgent?: string;
}

interface PushStoreFile {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  botPushToken: string;
  subscriptions: StoredPushSubscription[];
}

export function getPushDataDir(): string {
  const configured = process.env.PUSH_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), ".data");
}

function getStorePath(): string {
  return path.join(getPushDataDir(), "push-store.json");
}

function getTokenPath(): string {
  return path.join(getPushDataDir(), "bot-push-token");
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
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

let cachedStore: PushStoreFile | null = null;
let cachedStorePath: string | null = null;

function ensureStore(): PushStoreFile {
  const storePath = getStorePath();
  if (cachedStore && cachedStorePath === storePath) {
    return cachedStore;
  }

  const dir = getPushDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  if (fs.existsSync(storePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as Partial<PushStoreFile>;
      if (parsed.vapidPublicKey && parsed.vapidPrivateKey && parsed.botPushToken) {
        const loaded: PushStoreFile = {
          vapidPublicKey: parsed.vapidPublicKey,
          vapidPrivateKey: parsed.vapidPrivateKey,
          botPushToken: parsed.botPushToken,
          subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        };
        persistBotToken(loaded.botPushToken);
        cachedStore = loaded;
        cachedStorePath = storePath;
        return loaded;
      }
    } catch {
      // Regenerate corrupted store
    }
  }

  const keys = webpush.generateVAPIDKeys();
  const fresh: PushStoreFile = {
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    botPushToken: crypto.randomBytes(32).toString("hex"),
    subscriptions: [],
  };
  saveStore(fresh);
  return fresh;
}

function persistBotToken(token: string): void {
  try {
    const tokenPath = getTokenPath();
    fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  } catch {
    // Non-fatal on Windows/restricted FS
  }
}

function saveStore(store: PushStoreFile): void {
  const dir = getPushDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const storePath = getStorePath();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  persistBotToken(store.botPushToken);
  cachedStore = store;
  cachedStorePath = storePath;
}

function configureVapid(store: PushStoreFile): void {
  // Apple Web Push (web.push.apple.com) rejects `.localhost` / bare hostnames in VAPID `sub`.
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:notifications@hermes-pocket.app";
  webpush.setVapidDetails(subject, store.vapidPublicKey, store.vapidPrivateKey);
}

export async function verifyHermesSession(req: IncomingMessage, config: ServerConfig): Promise<boolean> {
  const cookie = req.headers.cookie;
  if (!cookie) return false;
  try {
    const res = await fetch(`${config.hermesBaseUrl}/api/auth/me`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: String(cookie),
        "User-Agent": "hermes-pocket-bff/0.1",
      },
      redirect: "manual",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function hasValidBotPushToken(req: IncomingMessage, store: PushStoreFile): boolean {
  const header = req.headers["x-pocket-push-token"];
  const candidate = typeof header === "string" ? header.trim() : "";
  if (!candidate || candidate.length !== store.botPushToken.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(candidate, "utf8"),
      Buffer.from(store.botPushToken, "utf8")
    );
  } catch {
    return false;
  }
}

export async function dispatchPushNotification(payload: {
  title: string;
  body: string;
  bot?: string;
  tag?: string;
  url?: string;
}): Promise<{ sent: number; failed: number; total: number; lastError?: string }> {
  const store = ensureStore();
  if (store.subscriptions.length === 0) {
    return { sent: 0, failed: 0, total: 0 };
  }

  configureVapid(store);
  const jsonPayload = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 320),
    bot: payload.bot || "",
    tag: payload.tag || (payload.bot ? `hermes-bot-${payload.bot}` : "hermes-pocket"),
    url: payload.url || (payload.bot ? `/?bot=${encodeURIComponent(payload.bot)}` : "/"),
  });

  let sent = 0;
  let failed = 0;
  let lastError: string | undefined;
  const expiredEndpoints = new Set<string>();

  await Promise.all(
    store.subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime ?? null,
            keys: sub.keys,
          },
          jsonPayload,
          { TTL: 3600 }
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : 0;
        const body =
          err && typeof err === "object" && "body" in err
            ? String((err as { body?: unknown }).body || "")
            : "";
        const msg = err instanceof Error ? err.message : String(err);
        lastError = statusCode ? `HTTP ${statusCode} ${body || msg}`.trim() : msg;
        console.error("[hermes-pocket] Web Push send failed:", lastError);
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.add(sub.endpoint);
        }
      }
    })
  );

  if (expiredEndpoints.size > 0) {
    store.subscriptions = store.subscriptions.filter((s) => !expiredEndpoints.has(s.endpoint));
    saveStore(store);
  }

  return { sent, failed, total: store.subscriptions.length, ...(lastError ? { lastError } : {}) };
}

export async function handlePocketPushRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith("/api/pocket/push/")) {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  const store = ensureStore();

  // /api/pocket/push/notify accepts EITHER local bot token OR authenticated Same-Origin user session
  if (pathname === "/api/pocket/push/notify") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }

    const tokenAuth = hasValidBotPushToken(req, store);
    if (!tokenAuth) {
      if (!isSameOriginRequest(req)) {
        sendJson(res, 403, { error: "forbidden_origin" });
        return true;
      }
      const userOk = await verifyHermesSession(req, config);
      if (!userOk) {
        sendJson(res, 401, { error: "unauthorized", detail: "Anmeldung erforderlich." });
        return true;
      }
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "bad_request", detail: "Ungültiger JSON-Body." });
      return true;
    }

    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Hermes Pocket";
    const text = typeof body.body === "string" && body.body.trim() ? body.body.trim() : "";
    const bot = typeof body.bot === "string" ? body.bot.trim() : "";
    const tag = typeof body.tag === "string" ? body.tag.trim() : undefined;

    if (!text) {
      sendJson(res, 400, { error: "invalid_body", detail: "Nachrichtentext fehlt." });
      return true;
    }

    const stats = await dispatchPushNotification({ title, body: text, bot, tag });
    sendJson(res, 200, { ok: true, ...stats });
    return true;
  }

  // All browser-facing push management routes require Same-Origin + valid Hermes auth cookie
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin", detail: "Cross-Origin-Anfrage abgelehnt." });
    return true;
  }

  const authenticated = await verifyHermesSession(req, config);
  if (!authenticated) {
    sendJson(res, 401, { error: "unauthorized", detail: "Anmeldung bei Hermes erforderlich." });
    return true;
  }

  if (pathname === "/api/pocket/push/status" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      supported: true,
      vapidPublicKey: store.vapidPublicKey,
      subscribedCount: store.subscriptions.length,
    });
    return true;
  }

  if (pathname === "/api/pocket/push/subscribe" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "bad_request" });
      return true;
    }

    const sub = (body.subscription && typeof body.subscription === "object"
      ? body.subscription
      : body) as Record<string, unknown>;
    const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
    const keys =
      sub.keys && typeof sub.keys === "object" ? (sub.keys as Record<string, unknown>) : null;
    const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh.trim() : "";
    const auth = typeof keys?.auth === "string" ? keys.auth.trim() : "";

    if (!endpoint.startsWith("https://") || !p256dh || !auth) {
      sendJson(res, 400, { error: "invalid_subscription", detail: "Ungültige Push-Subscription." });
      return true;
    }

    const existingIdx = store.subscriptions.findIndex((s) => s.endpoint === endpoint);
    const entry: StoredPushSubscription = {
      endpoint,
      expirationTime: typeof sub.expirationTime === "number" ? sub.expirationTime : null,
      keys: { p256dh, auth },
      createdAt: Date.now(),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 120),
    };
    if (existingIdx >= 0) {
      store.subscriptions[existingIdx] = entry;
    } else {
      store.subscriptions.push(entry);
      if (store.subscriptions.length > 10) {
        store.subscriptions = store.subscriptions.slice(-10);
      }
    }
    saveStore(store);
    sendJson(res, 200, { ok: true, subscribedCount: store.subscriptions.length });
    return true;
  }

  if (pathname === "/api/pocket/push/unsubscribe" && method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await readJsonBody(req);
    } catch {
      // ignore
    }
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (endpoint) {
      store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint);
    } else {
      store.subscriptions = [];
    }
    saveStore(store);
    sendJson(res, 200, { ok: true, subscribedCount: store.subscriptions.length });
    return true;
  }

  if (pathname === "/api/pocket/push/test" && method === "POST") {
    const stats = await dispatchPushNotification({
      title: "Hermes Pocket",
      body: "Push-Benachrichtigungen funktionieren! Deine Bots können dich jetzt direkt erreichen.",
      tag: "hermes-pocket-test",
    });
    sendJson(res, 200, { ok: true, ...stats });
    return true;
  }

  sendJson(res, 404, { error: "not_found" });
  return true;
}
