import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { verifyHermesSession } from "./push.js";

/**
 * Tells the app which live browser desktop (KasmVNC behind Tailscale Serve) a bot is attached to,
 * so every bot chat can offer an "open browser" button. The bot's own `config.yaml` decides:
 * `browser.cdp_url: http://127.0.0.1:<port>`. The CDP port is mapped to the desktop port that is
 * published next to the app (same host, other HTTPS port). Private bots never get a desktop.
 */

export interface BrowserDesktopEntry {
  port: number;
  label: string;
}

const DEFAULT_DESKTOPS: Record<string, BrowserDesktopEntry> = {
  "9223": { port: 8445, label: "Eigener Browser (mit Anmeldungen)" },
  "9224": { port: 8446, label: "Gemeinsamer Recherche-Browser" },
};

const SAFE_PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function desktopMap(): Record<string, BrowserDesktopEntry> {
  const raw = process.env.HERMES_POCKET_BROWSER_DESKTOPS?.trim();
  if (!raw) return DEFAULT_DESKTOPS;
  try {
    const parsed = JSON.parse(raw) as Record<string, BrowserDesktopEntry>;
    return parsed && typeof parsed === "object" ? parsed : DEFAULT_DESKTOPS;
  } catch {
    return DEFAULT_DESKTOPS;
  }
}

/** Port of `browser.cdp_url` in a Hermes profile `config.yaml`, or null. */
export function parseBrowserCdpPort(configText: string): number | null {
  const lines = configText.split(/\r?\n/);
  let inBrowser = false;
  let browserIndent = -1;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (!inBrowser) {
      if (indent === 0 && /^browser\s*:\s*$/.test(trimmed)) {
        inBrowser = true;
        browserIndent = indent;
      }
      continue;
    }
    if (indent <= browserIndent) {
      inBrowser = false;
      continue;
    }
    const m = trimmed.match(/^cdp_url\s*:\s*["']?https?:\/\/[^:/\s"']+:(\d{2,5})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

export function resolveBrowserDesktop(
  profileName: string,
  opts: { hermesHome?: string; isPrivate?: boolean } = {}
): { available: boolean; port?: number; label?: string } {
  const clean = profileName.trim();
  if (!clean || !SAFE_PROFILE_NAME_RE.test(clean) || opts.isPrivate) return { available: false };
  const hermesHome = opts.hermesHome || process.env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes");
  try {
    const file = path.join(hermesHome, "profiles", clean, "config.yaml");
    if (!fs.existsSync(file)) return { available: false };
    const cdpPort = parseBrowserCdpPort(fs.readFileSync(file, "utf8"));
    if (cdpPort === null) return { available: false };
    const entry = desktopMap()[String(cdpPort)];
    return entry ? { available: true, port: entry.port, label: entry.label } : { available: false };
  } catch {
    return { available: false };
  }
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export async function handlePocketBrowserDesktopRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL,
  isPrivate: (profile: string) => boolean
): Promise<boolean> {
  if (parsedUrl.pathname !== "/api/pocket/browser-desktop") return false;
  if ((req.method || "GET").toUpperCase() !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!(await verifyHermesSession(req, config))) {
    sendJson(res, 401, { error: "unauthorized" });
    return true;
  }
  const profile = (parsedUrl.searchParams.get("profile") || "").trim();
  sendJson(res, 200, resolveBrowserDesktop(profile, { isPrivate: isPrivate(profile) }));
  return true;
}
