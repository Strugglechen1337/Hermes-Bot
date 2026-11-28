import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.js";

function toWsOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

/**
 * Mints a real session-bound 30s single-use WebSocket ticket from Hermes using the
 * caller's own session cookies. Never bypasses Hermes authentication.
 */
async function mintHermesWsTicket(
  config: ServerConfig,
  cookieHeader: string | undefined
): Promise<{ ok: true; ticket: string } | { ok: false; status: number; reason: string }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "hermes-pocket-bff/0.1",
  };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${config.hermesBaseUrl}/api/auth/ws-ticket`, {
      method: "POST",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: res.status === 401 ? "unauthenticated" : `ws_ticket_failed_${res.status}`,
      };
    }
    const data = (await res.json()) as { ticket?: string };
    if (!data?.ticket) {
      return { ok: false, status: 502, reason: "missing_ticket" };
    }
    return { ok: true, ticket: data.ticket };
  } catch {
    clearTimeout(timeout);
    return { ok: false, status: 502, reason: "upstream_unreachable" };
  }
}

/**
 * When the phone app is backgrounded (e.g. to read an SMS code or approve a login in another
 * app) iOS closes the browser WebSocket. Hermes treats a closed socket as "user declined" for any
 * open server request (2FA code, approval, clarify) and the agent aborts the task. To survive that,
 * the bridge keeps the upstream socket alive for a short grace period while such a request is
 * unanswered, and hands it to the same user's next WebSocket (replaying the open requests).
 * The default stays below Hermes's own 180 s request timeout.
 */
const DEFAULT_HOLD_MS = 170_000;
const MAX_BUFFERED_FRAMES = 500;
const MAX_QUEUED_CLIENT_MESSAGES = 64;

interface QueuedFrame {
  data: Buffer | string;
  isBinary: boolean;
}

interface Bridge {
  key: string;
  upstream: WebSocket;
  client: WebSocket | null;
  /** Unanswered Hermes -> client requests (id -> raw frame text), replayed after a reconnect. */
  pendingRequests: Map<string, string>;
  /** Events that arrived while no client was attached. */
  buffered: QueuedFrame[];
  /** Client messages sent before the upstream socket finished connecting. */
  clientQueue: QueuedFrame[];
  holdTimer: NodeJS.Timeout | null;
}

const heldBridges = new Map<string, Bridge>();

export function heldBridgeCount(): number {
  return heldBridges.size;
}

function holdMs(): number {
  const raw = process.env.HERMES_POCKET_WS_HOLD_MS;
  if (raw === undefined || raw === "") return DEFAULT_HOLD_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_HOLD_MS;
}

function sessionKey(cookieHeader: string | undefined): string {
  return createHash("sha256")
    .update(cookieHeader || "anonymous")
    .digest("hex");
}

function takeHeldBridge(key: string): Bridge | null {
  const held = heldBridges.get(key);
  if (!held) return null;
  heldBridges.delete(key);
  if (held.holdTimer) {
    clearTimeout(held.holdTimer);
    held.holdTimer = null;
  }
  if (held.upstream.readyState !== WebSocket.OPEN) return null;
  return held;
}

function safeClose(ws: WebSocket, code: number, reason: string) {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    const validCode = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1000;
    try {
      ws.close(validCode, reason.slice(0, 120));
    } catch {
      ws.terminate();
    }
  }
}

function parseFrame(data: Buffer | string, isBinary: boolean): Record<string, unknown> | null {
  if (isBinary) return null;
  try {
    const parsed: unknown = JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function holdBridge(bridge: Bridge) {
  bridge.client = null;
  const previous = heldBridges.get(bridge.key);
  if (previous && previous !== bridge) {
    if (previous.holdTimer) clearTimeout(previous.holdTimer);
    safeClose(previous.upstream, 1000, "replaced_by_newer_hold");
  }
  heldBridges.set(bridge.key, bridge);
  bridge.holdTimer = setTimeout(() => {
    if (heldBridges.get(bridge.key) === bridge) heldBridges.delete(bridge.key);
    bridge.holdTimer = null;
    safeClose(bridge.upstream, 1000, "client_closed");
  }, holdMs());
  bridge.holdTimer.unref?.();
}

function shouldHold(bridge: Bridge): boolean {
  return bridge.pendingRequests.size > 0 && bridge.upstream.readyState === WebSocket.OPEN;
}

function attachClient(bridge: Bridge, clientWs: WebSocket) {
  bridge.client = clientWs;

  clientWs.on("message", (data, isBinary) => {
    const payload = isBinary
      ? Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer)
      : data.toString();
    const frame = parseFrame(payload, isBinary);
    if (
      frame &&
      frame.id !== undefined &&
      frame.id !== null &&
      typeof frame.method !== "string" &&
      ("result" in frame || "error" in frame)
    ) {
      bridge.pendingRequests.delete(String(frame.id));
    }
    if (bridge.upstream.readyState === WebSocket.OPEN) {
      bridge.upstream.send(payload, { binary: isBinary });
    } else if (
      bridge.upstream.readyState === WebSocket.CONNECTING &&
      bridge.clientQueue.length < MAX_QUEUED_CLIENT_MESSAGES
    ) {
      bridge.clientQueue.push({ data: payload, isBinary });
    }
  });

  clientWs.on("close", (code, reason) => {
    if (bridge.client !== clientWs) return;
    if (shouldHold(bridge)) {
      holdBridge(bridge);
      return;
    }
    safeClose(bridge.upstream, code, reason.toString("utf8") || "client_closed");
  });

  clientWs.on("error", () => {
    if (bridge.client !== clientWs) return;
    if (shouldHold(bridge)) {
      holdBridge(bridge);
      return;
    }
    safeClose(bridge.upstream, 1011, "client_ws_error");
  });
}

function replayToClient(bridge: Bridge, clientWs: WebSocket) {
  for (const frame of bridge.pendingRequests.values()) {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(frame);
  }
  const buffered = bridge.buffered.splice(0);
  for (const item of buffered) {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(item.data, { binary: item.isBinary });
  }
}

export function attachHermesWsBridge(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  config: ServerConfig
): void {
  const parsedUrl = new URL(req.url || "/", "http://localhost");
  if (parsedUrl.pathname !== "/api/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  // Enforce Origin check on browser WS upgrades
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      const expectedHost = String(Array.isArray(host) ? host[0] : host)
        .split(",")[0]
        .trim()
        .toLowerCase();
      if (originHost !== expectedHost) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  const key = sessionKey(req.headers.cookie);

  void (async () => {
    // Same user returning within the grace period: reuse the held upstream (no new ticket needed).
    const held = takeHeldBridge(key);
    if (held) {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        attachClient(held, clientWs);
        replayToClient(held, clientWs);
      });
      return;
    }

    const ticketResult = await mintHermesWsTicket(config, req.headers.cookie);
    if (!ticketResult.ok) {
      const statusLine =
        ticketResult.status === 401 ? "401 Unauthorized" : "502 Bad Gateway";
      socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
      socket.destroy();
      return;
    }

    const upstreamWsUrl = `${toWsOrigin(config.hermesBaseUrl)}/api/ws?ticket=${encodeURIComponent(
      ticketResult.ticket
    )}`;

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const upstreamWs = new WebSocket(upstreamWsUrl, {
        headers: {
          "User-Agent": "hermes-pocket-bff/0.1",
        },
        handshakeTimeout: 10_000,
      });

      const bridge: Bridge = {
        key,
        upstream: upstreamWs,
        client: null,
        pendingRequests: new Map(),
        buffered: [],
        clientQueue: [],
        holdTimer: null,
      };

      upstreamWs.on("open", () => {
        while (bridge.clientQueue.length > 0 && upstreamWs.readyState === WebSocket.OPEN) {
          const msg = bridge.clientQueue.shift()!;
          upstreamWs.send(msg.data, { binary: msg.isBinary });
        }
      });

      upstreamWs.on("message", (data, isBinary) => {
        const frame = parseFrame(data as Buffer, isBinary);
        const isServerRequest =
          !!frame &&
          typeof frame.method === "string" &&
          frame.method !== "event" &&
          frame.id !== undefined &&
          frame.id !== null;
        if (isServerRequest) {
          bridge.pendingRequests.set(String(frame.id), (data as Buffer).toString("utf8"));
        }
        const client = bridge.client;
        if (client && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        } else if (!client && !isServerRequest && bridge.buffered.length < MAX_BUFFERED_FRAMES) {
          // Held while the app is in the background: keep events for the reconnect.
          bridge.buffered.push({ data: data as Buffer, isBinary });
        }
      });

      upstreamWs.on("close", (code, reason) => {
        if (bridge.holdTimer) clearTimeout(bridge.holdTimer);
        if (heldBridges.get(key) === bridge) heldBridges.delete(key);
        if (bridge.client) safeClose(bridge.client, code, reason.toString("utf8") || "upstream_closed");
      });

      upstreamWs.on("error", () => {
        if (bridge.client) safeClose(bridge.client, 1011, "upstream_ws_error");
      });

      attachClient(bridge, clientWs);
    });
  })();
}
