import fs from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { ServerConfig } from "./config.js";
import { verifyHermesSession } from "./push.js";

/**
 * Reverse proxy for the bots' live browser desktops (KasmVNC in Docker), served under
 * `/desk/<id>/` on the app's own origin so the app can embed it. The visitor must hold a valid
 * Hermes session; the desktop's own basic-auth credentials are added here, server side, and never
 * reach the client. Desktops listen on 127.0.0.1 only.
 */

export interface DeskTarget {
  /** Local port of the desktop (KasmVNC HTTP). */
  upstreamPort: number;
  label: string;
}

/** Desk id = the CDP port the bots attach to (`browser.cdp_url`), e.g. `9223`. */
const DEFAULT_DESKS: Record<string, DeskTarget> = {
  "9223": { upstreamPort: 3000, label: "Eigener Browser (mit Anmeldungen)" },
  "9224": { upstreamPort: 3010, label: "Gemeinsamer Recherche-Browser" },
};

export function deskMap(): Record<string, DeskTarget> {
  const raw = process.env.HERMES_POCKET_BROWSER_DESKTOPS?.trim();
  if (!raw) return DEFAULT_DESKS;
  try {
    const parsed = JSON.parse(raw) as Record<string, DeskTarget>;
    return parsed && typeof parsed === "object" ? parsed : DEFAULT_DESKS;
  } catch {
    return DEFAULT_DESKS;
  }
}

export function parseDeskPath(url: string | undefined): { id: string; target: DeskTarget } | null {
  const m = (url || "").match(/^\/desk\/(\d{2,5})(\/|\?|$)/);
  if (!m) return null;
  const target = deskMap()[m[1]];
  return target ? { id: m[1], target } : null;
}

let cachedAuth: { value: string; at: number } | null = null;

/** `Basic <base64>` for the desktop, from the compose `.env` next to the containers. */
export function desktopAuthHeader(): string | null {
  const now = Date.now();
  if (cachedAuth && now - cachedAuth.at < 60_000) return cachedAuth.value || null;
  let value = "";
  try {
    const file =
      process.env.HERMES_POCKET_BROWSER_ENV?.trim() ||
      path.join(os.homedir(), "hermes-browser", ".env");
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    if (env.CUSTOM_USER && env.PASSWORD) {
      value = `Basic ${Buffer.from(`${env.CUSTOM_USER}:${env.PASSWORD}`).toString("base64")}`;
    }
  } catch {
    value = "";
  }
  cachedAuth = { value, at: now };
  return value || null;
}

/** `/desk/9223/vnc.html?x=1` -> `/vnc.html?x=1` (the desktop serves from its own root). */
export function stripDeskPrefix(url: string | undefined): string {
  const rest = (url || "").replace(/^\/desk\/\d{2,5}/, "");
  return rest.startsWith("/") ? rest : `/${rest}`;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(String(origin)).host === req.headers.host;
  } catch {
    return false;
  }
}

function fail(res: ServerResponse, status: number, error: string) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error }));
}

const DROP_REQ_HEADERS = new Set(["cookie", "authorization", "host", "connection", "origin", "referer"]);

export async function handleDeskHttp(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig
): Promise<boolean> {
  if (!(req.url || "").startsWith("/desk/")) return false;
  const desk = parseDeskPath(req.url);
  if (!desk) {
    fail(res, 404, "unknown_desktop");
    return true;
  }
  if (!(await verifyHermesSession(req, config))) {
    fail(res, 401, "unauthorized");
    return true;
  }
  const auth = desktopAuthHeader();
  if (!auth) {
    fail(res, 503, "desktop_not_configured");
    return true;
  }
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined && !DROP_REQ_HEADERS.has(k)) headers[k] = v;
  }
  headers.authorization = auth;
  headers.host = `127.0.0.1:${desk.target.upstreamPort}`;
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: desk.target.upstreamPort,
      method: req.method,
      path: stripDeskPrefix(req.url),
      headers,
    },
    (up) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(up.headers)) {
        const key = k.toLowerCase();
        if (v === undefined || key === "x-frame-options" || key === "content-security-policy") continue;
        out[k] = key === "location" && typeof v === "string" && v.startsWith("/") ? `/desk/${desk.id}${v}` : v;
      }
      out["cache-control"] = "no-store";
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) fail(res, 502, "desktop_unreachable");
    else res.destroy();
  });
  req.pipe(upstream);
  return true;
}

export function isDeskUpgrade(req: IncomingMessage): boolean {
  return (req.url || "").startsWith("/desk/");
}

export async function handleDeskUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  config: ServerConfig
): Promise<void> {
  const reject = (code: number) => {
    socket.write(`HTTP/1.1 ${code} Error\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const desk = parseDeskPath(req.url);
  if (!desk) return reject(404);
  if (!sameOrigin(req)) return reject(403);
  if (!(await verifyHermesSession(req, config))) return reject(401);
  const auth = desktopAuthHeader();
  if (!auth) return reject(503);

  const upstream = net.connect(desk.target.upstreamPort, "127.0.0.1");
  upstream.on("error", () => reject(502));
  socket.on("error", () => upstream.destroy());
  upstream.on("connect", () => {
    const lines = [`${req.method} ${stripDeskPrefix(req.url)} HTTP/1.1`, `Host: 127.0.0.1:${desk.target.upstreamPort}`];
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || DROP_REQ_HEADERS.has(k)) continue;
      lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    }
    lines.push(`Authorization: ${auth}`, "Connection: Upgrade", "", "");
    upstream.write(lines.join("\r\n"));
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
}
