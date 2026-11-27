import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { appendAutonomousGuidance } from "../shared/botAutonomy.js";
import { handlePocketChecklistsRoute } from "./checklists.js";
import { handlePocketMediaRoute } from "./media.js";
import { handlePocketPagesRoute } from "./pages.js";
import { handlePocketPreferencesRoute } from "./preferences.js";
import { handlePocketShortcutRoute } from "./shortcuts.js";
import { handlePocketTranscribeRoute } from "./transcribe.js";
import { handlePocketUpdateRoute } from "./updater.js";
import {
  handlePocketPushRoute,
  isBotPrivateOnServer,
  setBotPrivateInPushStore,
} from "./push.js";
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

const HERMES_LLM_PROVIDER_KEYS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
]);

async function registerEnvPassthrough(
  config: ServerConfig,
  upstreamHeaders: Record<string, string>,
  profile: string,
  key: string
): Promise<boolean> {
  if (HERMES_LLM_PROVIDER_KEYS.has(key)) return false;
  try {
    const getQs = new URLSearchParams({ include_defaults: "false" });
    if (profile) getQs.set("profile", profile);
    const getRes = await fetch(`${config.hermesBaseUrl}/api/config?${getQs.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", ...(upstreamHeaders.Cookie ? { Cookie: upstreamHeaders.Cookie } : {}) },
      redirect: "manual",
    });
    if (!getRes.ok) return false;
    const cfg = (await getRes.json()) as Record<string, unknown>;
    const terminal =
      cfg.terminal && typeof cfg.terminal === "object"
        ? (cfg.terminal as Record<string, unknown>)
        : {};
    const existing = Array.isArray(terminal.env_passthrough)
      ? terminal.env_passthrough.filter((v): v is string => typeof v === "string")
      : [];
    if (existing.includes(key)) return true;

    const putQs = new URLSearchParams();
    if (profile) putQs.set("profile", profile);
    const putRes = await fetch(
      `${config.hermesBaseUrl}/api/config${putQs.toString() ? `?${putQs.toString()}` : ""}`,
      {
        method: "PUT",
        headers: upstreamHeaders,
        body: JSON.stringify({
          ...(profile ? { profile } : {}),
          config: {
            terminal: {
              env_passthrough: [...existing, key],
            },
          },
        }),
        redirect: "manual",
      }
    );
    return putRes.ok;
  } catch {
    return false;
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
    const passthroughRegistered = await registerEnvPassthrough(
      config,
      upstreamHeaders,
      profile,
      key
    );
    const effectiveProfile = profile || "default";
    const envPathHint =
      effectiveProfile === "default"
        ? "~/.hermes/.env"
        : `~/.hermes/profiles/${effectiveProfile}/.env`;
    sendJson(res, 200, {
      ok: true,
      key,
      profile: effectiveProfile,
      passthroughRegistered,
      envPathHint,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
      detail: "Hermes konnte den Schlüssel nicht speichern.",
    });
  }
}

async function handlePocketPrivacy(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL
): Promise<void> {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "PUT") {
    sendJson(res, 405, { error: "method_not_allowed", detail: "Nur PUT erlaubt." });
    return;
  }
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin", detail: "Cross-Origin-Anfrage abgelehnt." });
    return;
  }

  let parsedBody: Record<string, unknown> = {};
  try {
    const rawBody = await readBody(req, 16 * 1024);
    parsedBody = rawBody ? (JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>) : {};
  } catch {
    sendJson(res, 400, { error: "bad_request", detail: "Ungültiger Request-Body." });
    return;
  }

  const isPrivate = Boolean(parsedBody.private);
  const profile =
    (typeof parsedBody.profile === "string" ? parsedBody.profile.trim() : "") ||
    parsedUrl.searchParams.get("profile")?.trim() ||
    "";

  if (!profile || profile === "default") {
    sendJson(res, 400, {
      error: "invalid_profile",
      detail: "Nur benannte Bot-Profile können isoliert werden.",
    });
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
    const qs = new URLSearchParams({ profile });
    const putUrl = `${config.hermesBaseUrl}/api/config?${qs.toString()}`;
    const upstreamRes = await fetch(putUrl, {
      method: "PUT",
      headers: upstreamHeaders,
      body: JSON.stringify({
        profile,
        config: {
          agent: {
            bot_mode_protocol: !isPrivate,
          },
        },
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
    setBotPrivateInPushStore(profile, isPrivate);
    sendJson(res, 200, { ok: true, profile, private: isPrivate });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    sendJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? "upstream_timeout" : "upstream_unreachable",
      detail: "Hermes-Konfiguration konnte nicht aktualisiert werden.",
    });
  }
}

const SAFE_BOT_COMMAND_ALLOWLIST = [
  "execute_code",
  "script execution via -e/-c flag",
  "script execution via heredoc",
  "shell command via -c/-lc flag",
  "stop/restart system service",
];

async function bootstrapNewProfileDefaults(
  config: ServerConfig,
  cookieHeader: string | undefined,
  profileName: string
): Promise<void> {
  if (!profileName || profileName === "default" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profileName)) {
    return;
  }

  // 1. Apply autonomous execution defaults + safe, non-destructive command_allowlist
  // (never includes deletions/SSH/gateway stops; mail & deletions remain protected)
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "hermes-pocket-bff/0.1",
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    const qs = new URLSearchParams({ profile: profileName });
    await fetch(`${config.hermesBaseUrl}/api/config?${qs.toString()}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        profile: profileName,
        config: {
          agent: {
            task_completion_guidance: true,
            tool_use_enforcement: "auto",
          },
          approvals: {
            mode: "smart",
            timeout: 120,
            mcp_reload_confirm: false,
          },
          command_allowlist: SAFE_BOT_COMMAND_ALLOWLIST,
        },
      }),
      redirect: "manual",
    });
  } catch {
    // Non-fatal
  }

  // 2. Sync shared pocket-push & pocket-secret skills + ensure autonomous SOUL.md guidance
  try {
    const hermesHome = process.env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes");
    const profileDir = path.join(hermesHome, "profiles", profileName);
    const targetSkillsDir = path.join(profileDir, "skills");
    if (!fs.existsSync(profileDir)) {
      return;
    }
    for (const skillName of ["pocket-push", "pocket-secret", "pocket-shopping", "pocket-page"]) {
      const src = path.join(hermesHome, "skills", skillName, "SKILL.md");
      if (!fs.existsSync(src)) continue;
      const dstDir = path.join(targetSkillsDir, skillName);
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(src, path.join(dstDir, "SKILL.md"));
    }

    const soulPath = path.join(profileDir, "SOUL.md");
    const existingSoul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, "utf8") : "";
    const updatedSoul = appendAutonomousGuidance(existingSoul);
    if (updatedSoul !== existingSoul.trim()) {
      fs.writeFileSync(soulPath, `${updatedSoul}\n`, "utf8");
    }
  } catch {
    // Non-fatal
  }
}

export interface PocketProfileMeta {
  private?: boolean;
  chief?: boolean;
  pinned?: boolean;
}

const SAFE_PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * Reads `ui_meta.hermes-pocket` flags (`private`, `chief`, `pinned`) from a
 * Hermes profile's `profile.yaml` (and falls back to `config.yaml`
 * `bot_mode_protocol: false` / server push store for private isolation).
 * Ensures fresh PWA installs / new devices hydrate Chief, Pinned and Private
 * bots immediately even if Hermes's REST `GET /api/profiles` omits `ui_meta`.
 */
export function readPocketProfileMeta(
  profileName: string,
  hermesHomeOverride?: string
): PocketProfileMeta {
  const clean = profileName.trim();
  if (!clean || clean === "default" || !SAFE_PROFILE_NAME_RE.test(clean)) {
    return {};
  }

  const hermesHome =
    hermesHomeOverride ||
    process.env.HERMES_HOME?.trim() ||
    path.join(os.homedir(), ".hermes");
  const profileDir = path.join(hermesHome, "profiles", clean);
  const out: PocketProfileMeta = {};

  try {
    const profileYamlPath = path.join(profileDir, "profile.yaml");
    if (fs.existsSync(profileYamlPath)) {
      const lines = fs.readFileSync(profileYamlPath, "utf8").split(/\r?\n/);
      let inUiMeta = false;
      let uiMetaIndent = -1;
      let inPocket = false;
      let pocketIndent = -1;

      for (const line of lines) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const indent = line.length - line.trimStart().length;
        const trimmed = line.trim();

        if (!inUiMeta) {
          if (/^ui_meta\s*:\s*$/.test(trimmed)) {
            inUiMeta = true;
            uiMetaIndent = indent;
          }
          continue;
        }

        if (indent <= uiMetaIndent) {
          inUiMeta = false;
          inPocket = false;
          continue;
        }

        if (!inPocket) {
          if (/^["']?hermes-pocket["']?\s*:\s*$/.test(trimmed)) {
            inPocket = true;
            pocketIndent = indent;
          }
          continue;
        }

        if (indent <= pocketIndent) {
          inPocket = false;
          continue;
        }

        const match = trimmed.match(/^(private|chief|pinned)\s*:\s*(true|false)\b/i);
        if (match) {
          const key = match[1].toLowerCase() as keyof PocketProfileMeta;
          out[key] = match[2].toLowerCase() === "true";
        }
      }
    }

    if (out.private === undefined) {
      const configPath = path.join(profileDir, "config.yaml");
      if (fs.existsSync(configPath)) {
        const cfgText = fs.readFileSync(configPath, "utf8");
        if (/^\s*bot_mode_protocol\s*:\s*false\b/m.test(cfgText)) {
          out.private = true;
        }
      }
      if (!hermesHomeOverride && out.private === undefined && isBotPrivateOnServer(clean)) {
        out.private = true;
      }
    }
  } catch {
    // Non-fatal
  }

  return out;
}

export function enrichProfilesPayloadWithPocketMeta(
  rawJson: string,
  hermesHomeOverride?: string
): string {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const isArrayRoot = Array.isArray(parsed);
    const list = isArrayRoot
      ? (parsed as Array<Record<string, unknown>>)
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { profiles?: unknown }).profiles)
        ? ((parsed as { profiles: Array<Record<string, unknown>> }).profiles)
        : null;
    if (!list) return rawJson;

    let mutated = false;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name || name === "default") continue;

      const diskMeta = readPocketProfileMeta(name, hermesHomeOverride);
      if (
        diskMeta.private === undefined &&
        diskMeta.chief === undefined &&
        diskMeta.pinned === undefined
      ) {
        continue;
      }

      const existingUiMeta =
        item.ui_meta && typeof item.ui_meta === "object" && !Array.isArray(item.ui_meta)
          ? { ...(item.ui_meta as Record<string, unknown>) }
          : {};
      const existingPocket =
        existingUiMeta["hermes-pocket"] &&
        typeof existingUiMeta["hermes-pocket"] === "object" &&
        !Array.isArray(existingUiMeta["hermes-pocket"])
          ? { ...(existingUiMeta["hermes-pocket"] as Record<string, unknown>) }
          : {};

      const mergedPocket: Record<string, unknown> = {
        ...diskMeta,
        ...existingPocket,
      };
      // Disk private isolation always wins if Hermes REST omitted it
      if (diskMeta.private === true && existingPocket.private === undefined) {
        mergedPocket.private = true;
      }

      existingUiMeta["hermes-pocket"] = mergedPocket;
      item.ui_meta = existingUiMeta;
      mutated = true;
    }

    return mutated ? JSON.stringify(parsed) : rawJson;
  } catch {
    return rawJson;
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

  if (pathname === "/api/pocket/privacy") {
    await handlePocketPrivacy(req, res, config, parsedUrl);
    return true;
  }

  if (pathname.startsWith("/api/pocket/push/")) {
    return handlePocketPushRoute(req, res, config, pathname);
  }

  if (pathname === "/api/pocket/pages" || pathname.startsWith("/api/pocket/pages/")) {
    return handlePocketPagesRoute(req, res, config, pathname);
  }

  if (pathname === "/api/pocket/media" || pathname === "/api/pocket/media/list") {
    return handlePocketMediaRoute(req, res, config, parsedUrl);
  }

  if (pathname === "/api/pocket/preferences") {
    return handlePocketPreferencesRoute(req, res, config, pathname);
  }

  if (pathname.startsWith("/api/pocket/checklists/")) {
    return handlePocketChecklistsRoute(req, res, config, pathname);
  }

  if (
    pathname === "/api/pocket/shortcut" ||
    pathname === "/api/pocket/shortcut/config" ||
    pathname === "/api/pocket/shortcut/rotate"
  ) {
    return handlePocketShortcutRoute(req, res, config, pathname);
  }

  if (pathname === "/api/pocket/update-check") {
    return handlePocketUpdateRoute(req, res, config, parsedUrl);
  }

  if (pathname === "/api/pocket/transcribe") {
    return handlePocketTranscribeRoute(req, res, config, parsedUrl);
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
  const maxBytes =
    pathname === "/api/chat/file-upload" || pathname === "/api/audio/transcribe"
      ? MAX_UPLOAD_BODY_BYTES
      : MAX_BODY_BYTES;
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

    let resBuffer = Buffer.from(await upstreamRes.arrayBuffer());

    // Enrich GET /api/profiles with persisted ui_meta["hermes-pocket"] flags
    // (chief, pinned, private) from disk so fresh PWA installs / new devices
    // hydrate immediately without losing Chief or Private Vault isolation.
    if (method === "GET" && pathname === "/api/profiles" && upstreamRes.ok) {
      const enriched = enrichProfilesPayloadWithPocketMeta(resBuffer.toString("utf8"));
      resBuffer = Buffer.from(enriched, "utf8");
    }

    // Automatically equip newly created/imported Hermes profiles with safe non-destructive
    // command_allowlist + pocket-push & pocket-secret skills.
    if (method === "POST" && pathname === "/api/profiles" && upstreamRes.ok) {
      try {
        const created = JSON.parse(resBuffer.toString("utf8")) as { name?: unknown };
        if (typeof created?.name === "string" && created.name.trim()) {
          await bootstrapNewProfileDefaults(
            config,
            req.headers.cookie ? String(req.headers.cookie) : undefined,
            created.name.trim()
          );
        }
      } catch {
        // Non-fatal
      }
    }

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
