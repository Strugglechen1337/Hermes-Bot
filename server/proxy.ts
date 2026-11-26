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

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function normalizeFallbackList(raw: unknown): Array<{ provider: string; model: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ provider: string; model: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const provider = typeof rec.provider === "string" ? rec.provider.trim() : "";
    const model = typeof rec.model === "string" ? rec.model.trim() : "";
    if (!provider || !model) continue;
    if (!PROVIDER_SLUG_PATTERN.test(provider) || model.length > 160) continue;
    out.push({ provider, model });
    if (out.length >= 5) break;
  }
  return out;
}

async function handlePocketFallback(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL
): Promise<void> {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "PUT") {
    sendJson(res, 405, { error: "method_not_allowed", detail: "Methode nicht erlaubt." });
    return;
  }
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin", detail: "Cross-Origin-Anfrage abgelehnt." });
    return;
  }

  const profile = parsedUrl.searchParams.get("profile")?.trim() || "";
  const upstreamHeaders: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "hermes-pocket-bff/0.1",
  };
  if (req.headers.cookie) {
    upstreamHeaders.Cookie = String(req.headers.cookie);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    if (method === "GET") {
      const qs = new URLSearchParams({ include_defaults: "false" });
      if (profile) qs.set("profile", profile);
      const upstreamRes = await fetch(`${config.hermesBaseUrl}/api/config?${qs.toString()}`, {
        method: "GET",
        headers: upstreamHeaders,
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!upstreamRes.ok) {
        const text = await upstreamRes.text();
        res.writeHead(upstreamRes.status, {
          "Content-Type": upstreamRes.headers.get("content-type") || "application/json",
          "Cache-Control": "no-store",
        });
        res.end(text);
        return;
      }
      const cfg = (await upstreamRes.json()) as Record<string, unknown>;
      const fallback_providers = normalizeFallbackList(cfg?.fallback_providers);
      sendJson(res, 200, {
        ok: true,
        profile: profile || "default",
        fallback_providers,
      });
      return;
    }

    // PUT: strictly validate fallback_providers before forwarding to Hermes PUT /api/config
    const rawBody = await readBody(req, 64 * 1024);
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>) : {};
    } catch {
      clearTimeout(timeout);
      sendJson(res, 400, { error: "bad_request", detail: "Ungültiges JSON." });
      return;
    }

    if (!Array.isArray(parsedBody.fallback_providers)) {
      clearTimeout(timeout);
      sendJson(res, 400, {
        error: "invalid_fallback",
        detail: "fallback_providers muss eine Liste sein.",
      });
      return;
    }

    const sanitized = normalizeFallbackList(parsedBody.fallback_providers);
    const qs = new URLSearchParams();
    if (profile) qs.set("profile", profile);
    const putUrl = `${config.hermesBaseUrl}/api/config${qs.toString() ? `?${qs.toString()}` : ""}`;

    const upstreamRes = await fetch(putUrl, {
      method: "PUT",
      headers: {
        ...upstreamHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(profile ? { profile } : {}),
        config: { fallback_providers: sanitized },
      }),
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      res.writeHead(upstreamRes.status, {
        "Content-Type": upstreamRes.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      });
      res.end(text);
      return;
    }
    sendJson(res, 200, {
      ok: true,
      profile: profile || "default",
      fallback_providers: sanitized,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
      detail: "Hermes-Konfiguration konnte nicht erreicht werden.",
    });
  }
}

async function handlePocketSecret(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL
): Promise<void> {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "PUT") {
    sendJson(res, 405, { error: "method_not_allowed", detail: "Nur PUT erlaubt (Write-Only)." });
    return;
  }
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin", detail: "Cross-Origin-Anfrage abgelehnt." });
    return;
  }

  let parsedBody: Record<string, unknown> = {};
  try {
    const rawBody = await readBody(req, 32 * 1024);
    parsedBody = rawBody ? (JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>) : {};
  } catch {
    sendJson(res, 400, { error: "bad_request", detail: "Ungültiger Request-Body." });
    return;
  }

  const key = typeof parsedBody.key === "string" ? parsedBody.key.trim().toUpperCase() : "";
  const value = typeof parsedBody.value === "string" ? parsedBody.value : "";
  const profile =
    (typeof parsedBody.profile === "string" ? parsedBody.profile.trim() : "") ||
    parsedUrl.searchParams.get("profile")?.trim() ||
    "";

  if (!ENV_KEY_PATTERN.test(key)) {
    sendJson(res, 400, {
      error: "invalid_key",
      detail: "Schlüsselname muss aus Großbuchstaben, Ziffern und Unterstrichen bestehen (z. B. GITHUB_TOKEN).",
    });
    return;
  }
  if (!value.trim() || value.length > 8192) {
    sendJson(res, 400, { error: "invalid_value", detail: "Bitte einen gültigen Wert eingeben." });
    return;
  }

  const upstreamHeaders: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "hermes-pocket-bff/0.1",
  };
  if (req.headers.cookie) {
    upstreamHeaders.Cookie = String(req.headers.cookie);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const qs = new URLSearchParams();
    if (profile) qs.set("profile", profile);
    const putUrl = `${config.hermesBaseUrl}/api/env${qs.toString() ? `?${qs.toString()}` : ""}`;
    const upstreamRes = await fetch(putUrl, {
      method: "PUT",
      headers: upstreamHeaders,
      body: JSON.stringify({
        key,
        value,
        ...(profile ? { profile } : {}),
      }),
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      res.writeHead(upstreamRes.status, {
        "Content-Type": upstreamRes.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      });
      res.end(text);
      return;
    }
    sendJson(res, 200, { ok: true, key, profile: profile || "default" });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
      detail: "Hermes konnte den Schlüssel nicht speichern.",
    });
  }
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

  if (pathname === "/api/pocket/fallback") {
    await handlePocketFallback(req, res, config, parsedUrl);
    return true;
  }

  if (pathname === "/api/pocket/secret") {
    await handlePocketSecret(req, res, config, parsedUrl);
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
