#!/usr/bin/env node
/**
 * Read-only Schnittstellen-Inspektion für einen bestehenden Hermes-Server.
 *
 * Sicherheitshinweis:
 * - Sendet ausschließlich lesende GET-Anfragen (keine Schreibvorgänge, keine Nachrichten,
 *   keine Routinen-Auslösung, keine Konfigurationsänderungen).
 * - Gibt keine Secrets, Cookies, Tokens oder Nachrichteninhalte aus.
 */

import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const fileEnv = loadDotEnv(envPath);
const env = { ...fileEnv, ...process.env };

const baseUrl = (env.HERMES_BASE_URL || "").replace(/\/+$/, "");
const apiServerUrl = (env.HERMES_API_SERVER_URL || "").replace(/\/+$/, "");
const apiToken = env.HERMES_API_TOKEN || "";
const authCookie = env.HERMES_AUTH_COOKIE || "";

if (!baseUrl && !apiServerUrl) {
  console.error(
    "Fehler: Weder HERMES_BASE_URL noch HERMES_API_SERVER_URL ist gesetzt.\n" +
      "Bitte .env.example nach .env kopieren und mindestens HERMES_BASE_URL eintragen."
  );
  process.exit(1);
}

function buildHeaders() {
  const headers = {
    Accept: "application/json, text/html;q=0.8, */*;q=0.5",
    "User-Agent": "hermes-pocket-inspector/0.1 (read-only)",
  };
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }
  if (authCookie) {
    headers.Cookie = authCookie;
  }
  return headers;
}

function summarizeJsonShape(data, depth = 0) {
  if (data === null) return "null";
  if (Array.isArray(data)) {
    if (data.length === 0) return "Array(0)";
    return `Array(${data.length}) of ${summarizeJsonShape(data[0], depth + 1)}`;
  }
  if (typeof data === "object") {
    const keys = Object.keys(data);
    if (depth >= 2) return `Object{${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}}`;
    const entries = keys.slice(0, 12).map((k) => `${k}: ${summarizeJsonShape(data[k], depth + 1)}`);
    return `{ ${entries.join(", ")}${keys.length > 12 ? ", ..." : ""} }`;
  }
  return typeof data;
}

async function probeEndpoint(origin, endpoint) {
  const url = `${origin}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = res.headers.get("content-type") || "";
    const wwwAuth = res.headers.get("www-authenticate") || "";
    const location = res.headers.get("location") || "";
    const serverHeader = res.headers.get("server") || "";

    let detail = "";
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        const parsed = new URL(location, origin);
        detail = `redirect -> ${parsed.pathname}`;
      } catch {
        detail = "redirect";
      }
    } else if (contentType.includes("application/json")) {
      try {
        const json = await res.json();
        if (endpoint === "/openapi.json" && json && typeof json === "object") {
          const paths = Object.keys(json.paths || {});
          const info = json.info || {};
          detail = `OpenAPI title="${info.title || "?"}" version="${info.version || "?"}" paths(${paths.length}): ${paths.slice(0, 25).join(", ")}${paths.length > 25 ? ", ..." : ""}`;
        } else {
          detail = `JSON shape: ${summarizeJsonShape(json)}`;
        }
      } catch {
        detail = "JSON (unparseable)";
      }
    } else if (contentType.includes("text/html")) {
      const text = await res.text();
      const titleMatch = text.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
      detail = `HTML${titleMatch ? ` title="${titleMatch[1].trim()}"` : ""}`;
    } else {
      detail = contentType || "no content-type";
    }

    return {
      endpoint,
      status: res.status,
      wwwAuth: wwwAuth ? wwwAuth.split(/\s+/)[0] : "",
      server: serverHeader,
      detail,
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      endpoint,
      status: "ERR",
      wwwAuth: "",
      server: "",
      detail: err?.name === "AbortError" ? "Timeout (8s)" : err?.message || String(err),
    };
  }
}

async function inspectOrigin(label, origin, endpoints) {
  console.log(`\n=== ${label} ===`);
  console.log(`Auth-Header gesetzt: Bearer=${Boolean(apiToken)}, Cookie=${Boolean(authCookie)}`);
  for (const ep of endpoints) {
    const result = await probeEndpoint(origin, ep);
    const extras = [
      result.wwwAuth ? `www-auth=${result.wwwAuth}` : "",
      result.server ? `server=${result.server}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `${String(result.status).padEnd(4)} ${ep.padEnd(26)} ${result.detail}${extras ? ` [${extras}]` : ""}`
    );
  }
}

const webEndpoints = [
  "/",
  "/openapi.json",
  "/health",
  "/api/health",
  "/api/status",
  "/api/version",
  "/api/auth/status",
  "/api/profiles",
  "/api/agents",
  "/api/bots",
  "/api/sessions",
  "/api/groups",
  "/api/channels",
  "/api/cron",
  "/api/cron/jobs",
  "/api/routines",
  "/api/jobs",
  "/api/mail",
  "/api/email",
  "/api/integrations",
  "/api/config",
  "/v1/models",
];

const apiEndpoints = ["/health", "/openapi.json", "/v1/models"];

if (baseUrl) {
  await inspectOrigin("HERMES_BASE_URL", baseUrl, webEndpoints);
}
if (apiServerUrl && apiServerUrl !== baseUrl) {
  await inspectOrigin("HERMES_API_SERVER_URL", apiServerUrl, apiEndpoints);
}
