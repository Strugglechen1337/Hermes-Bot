import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { verifyHermesSession } from "./push.js";

/**
 * Lightweight, privacy-friendly update checker comparing the local package.json
 * version against the latest GitHub Release of `Strugglechen1337/Hermes-Pocket-`.
 * Cached in-memory for 30 minutes to avoid unnecessary network calls.
 */

const GITHUB_REPO = process.env.HERMES_BOTS_REPO?.trim() || "Strugglechen1337/Hermes-Bot";
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface UpdateCheckResult {
  ok: true;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string;
  checkedAt: number;
  updateCommand: string;
}

let cachedResult: UpdateCheckResult | null = null;

export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function readLocalVersion(): string {
  const candidates = [
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: unknown };
        if (typeof parsed.version === "string" && parsed.version.trim()) {
          return parsed.version.trim();
        }
      }
    } catch {
      // continue
    }
  }
  return "2.2.0";
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

export async function checkForAppUpdate(force = false): Promise<UpdateCheckResult> {
  if (!force && cachedResult && Date.now() - cachedResult.checkedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const currentVersion = readLocalVersion();
  const fallback: UpdateCheckResult = {
    ok: true,
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
    releaseNotes: "",
    checkedAt: Date.now(),
    updateCommand: "bash scripts/update.sh",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "hermes-bots-updater/2.0",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      cachedResult = fallback;
      return fallback;
    }
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
    };
    const latest = typeof data.tag_name === "string" ? data.tag_name.replace(/^v/i, "").trim() : null;
    const result: UpdateCheckResult = {
      ok: true,
      currentVersion,
      latestVersion: latest,
      updateAvailable: Boolean(latest && compareSemver(latest, currentVersion) > 0),
      releaseUrl: data.html_url || fallback.releaseUrl,
      releaseNotes: typeof data.body === "string" ? data.body.slice(0, 600) : "",
      checkedAt: Date.now(),
      updateCommand: "bash scripts/update.sh",
    };
    cachedResult = result;
    return result;
  } catch {
    clearTimeout(timeout);
    cachedResult = fallback;
    return fallback;
  }
}

export async function handlePocketUpdateRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL
): Promise<boolean> {
  if (parsedUrl.pathname !== "/api/pocket/update-check") {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const authed = await verifyHermesSession(req, config);
  if (!authed) {
    sendJson(res, 401, { error: "unauthorized" });
    return true;
  }

  const force = parsedUrl.searchParams.get("force") === "1";
  const result = await checkForAppUpdate(force);
  sendJson(res, 200, result as unknown as Record<string, unknown>);
  return true;
}
