import type { IncomingMessage } from "node:http";

/**
 * Strict allowlist of Hermes HTTP endpoints proxied by Hermes Pocket.
 * Anything outside this list is refused with 404 so Hermes Pocket never becomes
 * an open reverse proxy to arbitrary upstream paths.
 */
const ALLOWED_HTTP_RULES: Array<{ methods: Set<string>; pattern: RegExp }> = [
  { methods: new Set(["GET"]), pattern: /^\/api\/status$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/auth\/providers$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/auth\/me$/ },
  { methods: new Set(["POST"]), pattern: /^\/auth\/password-login$/ },
  { methods: new Set(["POST"]), pattern: /^\/auth\/logout$/ },

  // Profiles & sessions
  { methods: new Set(["GET", "POST"]), pattern: /^\/api\/profiles$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/profiles\/active$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/profiles\/sessions$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/profiles\/sessions\/sidebar$/ },
  { methods: new Set(["PATCH", "DELETE"]), pattern: /^\/api\/profiles\/[^/]+$/ },
  { methods: new Set(["GET", "PUT"]), pattern: /^\/api\/profiles\/[^/]+\/soul$/ },
  { methods: new Set(["PUT"]), pattern: /^\/api\/profiles\/[^/]+\/(description|model)$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/sessions$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/sessions\/search$/ },
  { methods: new Set(["GET", "PATCH", "DELETE"]), pattern: /^\/api\/sessions\/[^/]+$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/sessions\/[^/]+\/timeline$/ },
  { methods: new Set(["POST"]), pattern: /^\/api\/chat\/file-upload$/ },
  { methods: new Set(["POST"]), pattern: /^\/api\/audio\/transcribe$/ },

  // Models & AI providers
  { methods: new Set(["GET"]), pattern: /^\/api\/model\/(info|options|recommended-default)$/ },
  { methods: new Set(["POST"]), pattern: /^\/api\/model\/set$/ },

  // Routines (cron)
  { methods: new Set(["GET", "POST"]), pattern: /^\/api\/cron\/jobs$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/cron\/delivery-targets$/ },
  { methods: new Set(["GET", "PUT", "DELETE"]), pattern: /^\/api\/cron\/jobs\/[^/]+$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/cron\/jobs\/[^/]+\/runs$/ },
  { methods: new Set(["POST"]), pattern: /^\/api\/cron\/jobs\/[^/]+\/(pause|resume|trigger|cancel)$/ },

  // Email & messaging platforms
  { methods: new Set(["GET"]), pattern: /^\/api\/messaging\/platforms$/ },
  { methods: new Set(["PUT"]), pattern: /^\/api\/messaging\/platforms\/[^/]+$/ },
  { methods: new Set(["POST"]), pattern: /^\/api\/messaging\/platforms\/[^/]+\/test$/ },

  // MCP servers & catalog (Hermes Connectors)
  { methods: new Set(["GET", "POST"]), pattern: /^\/api\/mcp\/servers$/ },
  { methods: new Set(["DELETE"]), pattern: /^\/api\/mcp\/servers\/[^/]+$/ },
  { methods: new Set(["PUT"]), pattern: /^\/api\/mcp\/servers\/[^/]+\/enabled$/ },
  { methods: new Set(["POST"]), pattern: /^\/api\/mcp\/servers\/[^/]+\/(test|auth)$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/mcp\/catalog$/ },
  { methods: new Set(["POST"]), pattern: /^\/api\/mcp\/catalog\/install$/ },
  { methods: new Set(["GET", "DELETE"]), pattern: /^\/api\/mcp\/oauth\/flows\/[^/]+$/ },
  { methods: new Set(["GET"]), pattern: /^\/api\/mcp\/oauth\/callback\/.+$/ },
];

export function isAllowedHermesPath(method: string, pathname: string): boolean {
  if (pathname.includes("..") || pathname.includes("\\") || pathname.includes("\0")) {
    return false;
  }
  const upper = method.toUpperCase();
  return ALLOWED_HTTP_RULES.some(
    (rule) => rule.methods.has(upper) && rule.pattern.test(pathname)
  );
}

/**
 * Enforces Same-Origin protection for mutating browser requests to the BFF.
 * Mirrors Hermes's own cookie_origin_is_allowed semantics before forwarding.
 */
export function isSameOriginRequest(req: IncomingMessage): boolean {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

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
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Adapts upstream Set-Cookie headers for Hermes Pocket while preserving HttpOnly
 * and SameSite protection. Strips upstream Domain so cookies remain host-only
 * on the Hermes Pocket origin, and adjusts Secure based on actual client TLS.
 */
export function adaptSetCookieHeader(
  rawCookie: string,
  clientIsHttps: boolean
): string {
  const parts = rawCookie.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return rawCookie;

  const [nameValue, ...attrs] = parts;
  const kept: string[] = [nameValue];
  let hasSameSite = false;
  let hasPath = false;

  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower.startsWith("domain=")) {
      continue; // Keep host-only cookie on Hermes Pocket origin
    }
    if (lower === "secure") {
      continue; // Re-applied cleanly below according to clientIsHttps
    }
    if (lower.startsWith("path=")) {
      hasPath = true;
      kept.push("Path=/");
      continue;
    }
    if (lower.startsWith("samesite=")) {
      hasSameSite = true;
      kept.push(attr);
      continue;
    }
    kept.push(attr);
  }

  if (!hasPath) kept.push("Path=/");
  if (!hasSameSite) kept.push("SameSite=Lax");
  if (clientIsHttps) kept.push("Secure");

  return kept.join("; ");
}

export function isClientHttps(
  req: IncomingMessage,
  cookieSecure: "auto" | "true" | "false"
): boolean {
  if (cookieSecure === "true") return true;
  if (cookieSecure === "false") return false;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  return Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
}
