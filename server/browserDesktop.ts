import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { WebSocket } from "ws";
import { deskMap } from "./deskProxy.js";
import { isSameOriginRequest } from "./security.js";
import { verifyHermesSession } from "./push.js";

/**
 * Tells the app which live browser desktop (KasmVNC behind Tailscale Serve) a bot is attached to,
 * so every bot chat can offer an "open browser" button. The bot's own `config.yaml` decides:
 * `browser.cdp_url: http://127.0.0.1:<port>`. The CDP port is mapped to the desktop port that is
 * published next to the app (same host, other HTTPS port). Private bots never get a desktop.
 */

const SAFE_PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

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
): { available: boolean; id?: string; path?: string; label?: string } {
  const clean = profileName.trim();
  if (!clean || !SAFE_PROFILE_NAME_RE.test(clean) || opts.isPrivate) return { available: false };
  const hermesHome = opts.hermesHome || process.env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes");
  try {
    const file = path.join(hermesHome, "profiles", clean, "config.yaml");
    if (!fs.existsSync(file)) return { available: false };
    const cdpPort = parseBrowserCdpPort(fs.readFileSync(file, "utf8"));
    if (cdpPort === null) return { available: false };
    const entry = deskMap()[String(cdpPort)];
    return entry
      ? { available: true, id: String(cdpPort), path: `/desk/${cdpPort}/`, label: entry.label }
      : { available: false };
  } catch {
    return { available: false };
  }
}

interface CdpTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

/** Runs CDP commands on one page websocket and resolves with each result (5 s per command). */
function cdpSession(
  wsUrl: string,
  commands: { method: string; params?: Record<string, unknown> }[]
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results: unknown[] = [];
    let next = 0;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("cdp_timeout"));
    }, 5000 * Math.max(1, commands.length));
    const sendNext = () => ws.send(JSON.stringify({ id: next + 1, ...commands[next] }));
    ws.on("open", sendNext);
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (msg.id !== next + 1) return;
      if (msg.error) {
        clearTimeout(timer);
        ws.close();
        reject(new Error(msg.error.message || "cdp_error"));
        return;
      }
      results.push(msg.result);
      next += 1;
      if (next >= commands.length) {
        clearTimeout(timer);
        ws.close();
        resolve(results);
      } else sendNext();
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const MAX_INSERT_CHARS = 5000;

/** Types text into the focused field of the page the user currently sees in the desktop. */
export async function insertTextIntoActivePage(cdpPort: number, text: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const pages = ((await res.json()) as CdpTarget[]).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (pages.length === 0) throw new Error("no_page");
  let chosen = pages[0];
  for (const p of pages) {
    try {
      const [r] = (await cdpSession(p.webSocketDebuggerUrl as string, [
        { method: "Runtime.evaluate", params: { expression: "document.visibilityState", returnByValue: true } },
      ])) as { result?: { value?: string } }[];
      if (r?.result?.value === "visible") {
        chosen = p;
        break;
      }
    } catch {
      // try next page
    }
  }
  await cdpSession(chosen.webSocketDebuggerUrl as string, [
    { method: "Input.insertText", params: { text: text.slice(0, MAX_INSERT_CHARS) } },
  ]);
}

function readJsonBody(req: IncomingMessage, maxBytes = 20_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("too_large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", reject);
  });
}

export async function handlePocketBrowserTextRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL
): Promise<boolean> {
  if (parsedUrl.pathname !== "/api/pocket/browser-desktop/text") return false;
  if ((req.method || "GET").toUpperCase() !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin" });
    return true;
  }
  if (!(await verifyHermesSession(req, config))) {
    sendJson(res, 401, { error: "unauthorized" });
    return true;
  }
  try {
    const body = await readJsonBody(req);
    const id = String(body.id ?? "");
    const text = typeof body.text === "string" ? body.text : "";
    if (!deskMap()[id] || !text) {
      sendJson(res, 400, { error: "bad_request" });
      return true;
    }
    await insertTextIntoActivePage(Number(id), text);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : "failed" });
  }
  return true;
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
