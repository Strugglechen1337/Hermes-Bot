import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import {
  adaptSetCookieHeader,
  isAllowedHermesPath,
  isClientHttps,
  isSameOriginRequest,
} from "./security.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB limit for JSON API payloads
const MAX_UPLOAD_BODY_BYTES = 18 * 1024 * 1024; // 18 MiB limit for /api/chat/file-upload (Hermes cap: 16 MiB)

async function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer | undefined> {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export async function handleHermesHttpProxy(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig
): Promise<boolean> {
  const rawUrl = req.url || "/";
  const parsedUrl = new URL(rawUrl, "http://localhost");
  const pathname = parsedUrl.pathname;

  if (!pathname.startsWith("/api/") && !pathname.startsWith("/auth/")) {
    return false;
  }

  if (pathname === "/api/pocket/health" && (req.method || "GET").toUpperCase() === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "hermes-pocket",
      upstreamConfigured: Boolean(config.hermesBaseUrl),
    });
    return true;
  }

  const method = (req.method || "GET").toUpperCase();
  if (!isAllowedHermesPath(method, pathname)) {
    sendJson(res, 404, { error: "not_found", detail: "Endpunkt nicht freigegeben." });
    return true;
  }

  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin", detail: "Cross-Origin-Anfrage abgelehnt." });
    return true;
  }

  let body: Buffer | undefined;
  const maxBytes = pathname === "/api/chat/file-upload" ? MAX_UPLOAD_BODY_BYTES : MAX_BODY_BYTES;
  try {
    body = await readBody(req, maxBytes);
  } catch (err) {
    if (err instanceof Error && err.message === "BODY_TOO_LARGE") {
      sendJson(res, 413, { error: "payload_too_large", detail: "Anfrage zu groß." });
      return true;
    }
    sendJson(res, 400, { error: "bad_request", detail: "Ungültiger Request-Body." });
    return true;
  }

  const upstreamUrl = `${config.hermesBaseUrl}${pathname}${parsedUrl.search}`;
  const upstreamHeaders: Record<string, string> = {
    Accept: String(req.headers.accept || "application/json"),
    "User-Agent": "hermes-pocket-bff/0.1",
  };
  if (req.headers["content-type"]) {
    upstreamHeaders["Content-Type"] = String(req.headers["content-type"]);
  }
  if (req.headers.cookie) {
    upstreamHeaders.Cookie = String(req.headers.cookie);
  }
  // Note: Intentionally omit browser Origin/Sec-Fetch-Site when talking server-to-server
  // to Hermes, after enforcing our own Same-Origin check above, matching Hermes's
  // cookie_origin_is_allowed contract for trusted local/proxy callers.

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body: body ? new Uint8Array(body) : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const clientHttps = isClientHttps(req, config.cookieSecure);
    const getSetCookie = (upstreamRes.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie;
    const rawSetCookies = typeof getSetCookie === "function" ? getSetCookie.call(upstreamRes.headers) : [];

    const responseHeaders: Record<string, string | string[]> = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };

    const contentType = upstreamRes.headers.get("content-type");
    if (contentType) {
      responseHeaders["Content-Type"] = contentType;
    }

    if (rawSetCookies.length > 0) {
      responseHeaders["Set-Cookie"] = rawSetCookies.map((cookie) =>
        adaptSetCookieHeader(cookie, clientHttps)
      );
    }

    // Hermes POST /auth/logout returns 302 -> /login; translate cleanly to JSON for our SPA
    if (pathname === "/auth/logout" && upstreamRes.status >= 300 && upstreamRes.status < 400) {
      responseHeaders["Content-Type"] = "application/json; charset=utf-8";
      res.writeHead(200, responseHeaders);
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    const resBuffer = Buffer.from(await upstreamRes.arrayBuffer());
    res.writeHead(upstreamRes.status, responseHeaders);
    res.end(resBuffer);
    return true;
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
      detail: isTimeout
        ? "Hermes-Server hat nicht rechtzeitig geantwortet."
        : "Hermes-Server ist aktuell nicht erreichbar.",
    });
    return true;
  }
}
