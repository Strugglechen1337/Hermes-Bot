import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { verifyHermesSession } from "./push.js";

/**
 * Authenticated Hermes Media proxy (`/api/pocket/media?path=...`).
 *
 * Serves bot-generated files referenced via Hermes's native `MEDIA:/abs/path`
 * syntax directly into the chat UI (images, audio, video, documents) while
 * enforcing strict path & extension allowlists and blocking all sensitive
 * Hermes config/secret files.
 */

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MiB

const MIME_BY_EXT: Record<string, { mime: string; forceAttachment?: boolean }> = {
  // Images
  ".png": { mime: "image/png" },
  ".jpg": { mime: "image/jpeg" },
  ".jpeg": { mime: "image/jpeg" },
  ".webp": { mime: "image/webp" },
  ".gif": { mime: "image/gif" },
  ".avif": { mime: "image/avif" },
  // Audio
  ".mp3": { mime: "audio/mpeg" },
  ".wav": { mime: "audio/wav" },
  ".ogg": { mime: "audio/ogg" },
  ".opus": { mime: "audio/ogg" },
  ".m4a": { mime: "audio/mp4" },
  ".aac": { mime: "audio/aac" },
  // Video
  ".mp4": { mime: "video/mp4" },
  ".webm": { mime: "video/webm" },
  ".mov": { mime: "video/quicktime" },
  // Documents & files
  ".pdf": { mime: "application/pdf" },
  ".txt": { mime: "text/plain; charset=utf-8" },
  ".md": { mime: "text/markdown; charset=utf-8" },
  ".csv": { mime: "text/csv; charset=utf-8" },
  ".json": { mime: "application/json; charset=utf-8" },
  ".zip": { mime: "application/zip", forceAttachment: true },
  ".html": { mime: "text/plain; charset=utf-8", forceAttachment: true },
  ".svg": { mime: "application/octet-stream", forceAttachment: true },
};

const BLOCKED_SEGMENTS = new Set([
  ".git",
  ".ssh",
  "vault",
  "logs",
  "sessions",
  "memories",
  "cron",
  "pairing",
]);

const BLOCKED_BASENAME_RE =
  /^(?:\.env(?:\..*)?|config\.ya?ml|profile\.ya?ml|state\.db.*|projects\.db.*|auth.*|log_hash_salt|.*\.key|.*\.pem|.*\.sqlite.*|.*\.db.*|.*\.lock)$/i;

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function isInsideRoot(realFile: string, rootDir: string): boolean {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootDir);
  } catch {
    return false;
  }
  const rel = path.relative(realRoot, realFile);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export interface ResolvedMediaFile {
  ok: true;
  realPath: string;
  filename: string;
  mime: string;
  size: number;
  forceAttachment: boolean;
}

export interface RejectedMediaFile {
  ok: false;
  status: number;
  error: string;
}

export function resolveSafeMediaFile(
  rawPath: string,
  options?: { hermesHome?: string; extraAllowedRoots?: string[] }
): ResolvedMediaFile | RejectedMediaFile {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.includes("\0") || !path.isAbsolute(trimmed)) {
    return { ok: false, status: 400, error: "invalid_path" };
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(trimmed);
  } catch {
    return { ok: false, status: 404, error: "not_found" };
  }

  const hermesHome =
    options?.hermesHome ||
    process.env.HERMES_HOME?.trim() ||
    path.join(os.homedir(), ".hermes");
  const allowedRoots = [hermesHome, os.tmpdir(), ...(options?.extraAllowedRoots || [])];

  if (!allowedRoots.some((root) => isInsideRoot(realPath, root))) {
    return { ok: false, status: 403, error: "forbidden_path" };
  }

  const normalizedSegments = realPath.split(path.sep).filter(Boolean);
  for (const seg of normalizedSegments) {
    if (BLOCKED_SEGMENTS.has(seg.toLowerCase())) {
      return { ok: false, status: 403, error: "forbidden_path" };
    }
  }

  const filename = path.basename(realPath);
  if (BLOCKED_BASENAME_RE.test(filename)) {
    return { ok: false, status: 403, error: "forbidden_file" };
  }

  const ext = path.extname(filename).toLowerCase();
  const typeInfo = MIME_BY_EXT[ext];
  if (!typeInfo) {
    return { ok: false, status: 403, error: "unsupported_media_type" };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { ok: false, status: 404, error: "not_found" };
  }
  if (!stat.isFile()) {
    return { ok: false, status: 404, error: "not_found" };
  }
  if (stat.size > MAX_MEDIA_BYTES) {
    return { ok: false, status: 413, error: "file_too_large" };
  }

  return {
    ok: true,
    realPath,
    filename,
    mime: typeInfo.mime,
    size: stat.size,
    forceAttachment: Boolean(typeInfo.forceAttachment),
  };
}

function sanitizeHeaderFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

export async function handlePocketMediaRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL
): Promise<boolean> {
  if (parsedUrl.pathname !== "/api/pocket/media") {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  const authenticated = await verifyHermesSession(req, config);
  if (!authenticated) {
    sendJson(res, 401, { error: "unauthorized", detail: "Anmeldung bei Hermes erforderlich." });
    return true;
  }

  const requestedPath = parsedUrl.searchParams.get("path") || "";
  const resolved = resolveSafeMediaFile(requestedPath);
  if (!resolved.ok) {
    sendJson(res, resolved.status, { error: resolved.error });
    return true;
  }

  const forceDownload =
    resolved.forceAttachment || parsedUrl.searchParams.get("download") === "1";
  const safeName = sanitizeHeaderFilename(resolved.filename);
  const baseHeaders: Record<string, string | number> = {
    "Content-Type": resolved.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${safeName}"`,
  };

  const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : "";
  const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (rangeMatch && resolved.size > 0) {
    const start = rangeMatch[1] ? Number.parseInt(rangeMatch[1], 10) : 0;
    const end = rangeMatch[2]
      ? Math.min(Number.parseInt(rangeMatch[2], 10), resolved.size - 1)
      : resolved.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= resolved.size) {
      res.writeHead(416, { "Content-Range": `bytes */${resolved.size}` });
      res.end();
      return true;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      "Content-Range": `bytes ${start}-${end}/${resolved.size}`,
      "Content-Length": chunkSize,
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(resolved.realPath, { start, end }).pipe(res);
    return true;
  }

  res.writeHead(200, {
    ...baseHeaders,
    "Content-Length": resolved.size,
  });
  if (method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(resolved.realPath).pipe(res);
  return true;
}
