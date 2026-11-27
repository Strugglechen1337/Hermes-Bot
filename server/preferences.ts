import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { getPushDataDir, verifyHermesSession } from "./push.js";
import { isSameOriginRequest } from "./security.js";

/**
 * Multi-device UI preferences persisted on the Hermes Pocket BFF server
 * (`.data/ui-preferences.json`, mode 0600):
 * - `hiddenProfiles`: bots hidden from the main list across all devices
 * - `vaultPinHash`: SHA-256 hash of the Private Vault PIN (never plaintext)
 *
 * All reads and writes require a valid authenticated Hermes session cookie.
 */

export interface PocketUiPreferences {
  hiddenProfiles: string[];
  vaultPinHash: string | null;
  updatedAt: number;
}

const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const PIN_HASH_RE = /^(?:[a-f0-9]{64}|fnv1a:[a-f0-9]{1,16})$/i;

function getPrefsPath(): string {
  return path.join(getPushDataDir(), "ui-preferences.json");
}

function normalizeHiddenProfiles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter((x) => x !== "default" && PROFILE_NAME_RE.test(x))
    )
  ).slice(0, 100);
}

function normalizePinHash(raw: unknown): string | null {
  if (raw === null || raw === "") return null;
  if (typeof raw === "string" && PIN_HASH_RE.test(raw.trim())) {
    return raw.trim();
  }
  return null;
}

export function loadServerUiPreferences(): PocketUiPreferences {
  const filePath = getPrefsPath();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      return {
        hiddenProfiles: normalizeHiddenProfiles(parsed.hiddenProfiles),
        vaultPinHash: normalizePinHash(parsed.vaultPinHash),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      };
    }
  } catch {
    // Fall back to empty defaults
  }
  return { hiddenProfiles: [], vaultPinHash: null, updatedAt: 0 };
}

export function saveServerUiPreferences(
  patch: Partial<Pick<PocketUiPreferences, "hiddenProfiles" | "vaultPinHash">>
): PocketUiPreferences {
  const current = loadServerUiPreferences();
  const next: PocketUiPreferences = {
    hiddenProfiles:
      patch.hiddenProfiles !== undefined
        ? normalizeHiddenProfiles(patch.hiddenProfiles)
        : current.hiddenProfiles,
    vaultPinHash:
      patch.vaultPinHash !== undefined
        ? normalizePinHash(patch.vaultPinHash)
        : current.vaultPinHash,
    updatedAt: Date.now(),
  };

  const dir = getPushDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = getPrefsPath();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  return next;
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

export async function handlePocketPreferencesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  pathname: string
): Promise<boolean> {
  if (pathname !== "/api/pocket/preferences") {
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

  const authenticated = await verifyHermesSession(req, config);
  if (!authenticated) {
    sendJson(res, 401, { error: "unauthorized", detail: "Anmeldung bei Hermes erforderlich." });
    return true;
  }

  if (method === "GET") {
    const prefs = loadServerUiPreferences();
    sendJson(res, 200, { ok: true, ...prefs });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "bad_request" });
    return true;
  }

  const patch: Partial<Pick<PocketUiPreferences, "hiddenProfiles" | "vaultPinHash">> = {};
  if ("hiddenProfiles" in body) {
    patch.hiddenProfiles = normalizeHiddenProfiles(body.hiddenProfiles);
  }
  if ("vaultPinHash" in body) {
    if (body.vaultPinHash !== null && body.vaultPinHash !== "" && !normalizePinHash(body.vaultPinHash)) {
      sendJson(res, 400, { error: "invalid_pin_hash" });
      return true;
    }
    patch.vaultPinHash = normalizePinHash(body.vaultPinHash);
  }

  const updated = saveServerUiPreferences(patch);
  sendJson(res, 200, { ok: true, ...updated });
  return true;
}
