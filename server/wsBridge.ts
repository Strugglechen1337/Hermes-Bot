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

  void (async () => {
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

      const pendingClientMessages: Array<{ data: Buffer | string; isBinary: boolean }> = [];

      const safeClose = (ws: WebSocket, code: number, reason: string) => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          const validCode = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1000;
          try {
            ws.close(validCode, reason.slice(0, 120));
          } catch {
            ws.terminate();
          }
        }
      };

      upstreamWs.on("open", () => {
        while (pendingClientMessages.length > 0 && upstreamWs.readyState === WebSocket.OPEN) {
          const msg = pendingClientMessages.shift()!;
          upstreamWs.send(msg.data, { binary: msg.isBinary });
        }
      });

      upstreamWs.on("message", (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      upstreamWs.on("close", (code, reason) => {
        safeClose(clientWs, code, reason.toString("utf8") || "upstream_closed");
      });

      upstreamWs.on("error", () => {
        safeClose(clientWs, 1011, "upstream_ws_error");
      });

      clientWs.on("message", (data, isBinary) => {
        const payload = isBinary ? (Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)) : data.toString();
        if (upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.send(payload, { binary: isBinary });
        } else if (upstreamWs.readyState === WebSocket.CONNECTING && pendingClientMessages.length < 64) {
          pendingClientMessages.push({ data: payload, isBinary });
        }
      });

      clientWs.on("close", (code, reason) => {
        safeClose(upstreamWs, code, reason.toString("utf8") || "client_closed");
      });

      clientWs.on("error", () => {
        safeClose(upstreamWs, 1011, "client_ws_error");
      });
    });
  })();
}
