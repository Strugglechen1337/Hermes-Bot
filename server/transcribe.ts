import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { verifyHermesSession } from "./push.js";
import { isSameOriginRequest } from "./security.js";

/**
 * Authenticated speech-to-text endpoint (`POST /api/pocket/transcribe`).
 *
 * Uses a warm local `faster-whisper` Python worker (`.stt-venv/bin/python` +
 * `bin/stt-worker.py`, 100% private on the user's own server) when installed,
 * and falls back transparently to Hermes's `/api/audio/transcribe` otherwise.
 */

const MAX_AUDIO_BODY_BYTES = 16 * 1024 * 1024;

let workerProc: ChildProcessWithoutNullStreams | null = null;
let workerReady = false;
let workerBuffer = "";
let pendingQueue: Array<{
  resolve: (res: { ok: boolean; transcript?: string; provider?: string; error?: string }) => void;
  reject: (err: Error) => void;
}> = [];

function resolveLocalSttPaths(): { pythonBin: string; workerScript: string } | null {
  const candidates = [process.cwd(), path.resolve(process.cwd(), "..")];
  for (const base of candidates) {
    const py = path.join(base, ".stt-venv", "bin", "python");
    const script = path.join(base, "bin", "stt-worker.py");
    if (fs.existsSync(py) && fs.existsSync(script)) {
      return { pythonBin: py, workerScript: script };
    }
  }
  return null;
}

function ensureWorker(pythonBin: string, workerScript: string): ChildProcessWithoutNullStreams {
  if (workerProc && !workerProc.killed) return workerProc;
  workerReady = false;
  workerBuffer = "";
  const proc = spawn(pythonBin, [workerScript], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  workerProc = proc;

  proc.stdout.on("data", (chunk: Buffer) => {
    workerBuffer += chunk.toString("utf8");
    let nl = workerBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = workerBuffer.slice(0, nl).trim();
      workerBuffer = workerBuffer.slice(nl + 1);
      if (line) {
        try {
          const parsed = JSON.parse(line) as {
            ready?: boolean;
            ok?: boolean;
            transcript?: string;
            provider?: string;
            error?: string;
          };
          if (parsed.ready) {
            workerReady = true;
          } else {
            const waiter = pendingQueue.shift();
            if (waiter) {
              waiter.resolve({
                ok: Boolean(parsed.ok),
                transcript: parsed.transcript,
                provider: parsed.provider,
                error: parsed.error,
              });
            }
          }
        } catch {
          // ignore non-JSON log lines
        }
      }
      nl = workerBuffer.indexOf("\n");
    }
  });

  proc.on("exit", () => {
    workerProc = null;
    workerReady = false;
    while (pendingQueue.length > 0) {
      pendingQueue.shift()?.reject(new Error("STT-Worker beendet."));
    }
  });

  return proc;
}

function runLocalTranscribe(
  pythonBin: string,
  workerScript: string,
  audioPath: string,
  language = "de"
): Promise<{ ok: boolean; transcript?: string; provider?: string; error?: string }> {
  const proc = ensureWorker(pythonBin, workerScript);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Transkription hat zu lange gedauert."));
    }, workerReady ? 30_000 : 120_000);

    pendingQueue.push({
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    proc.stdin.write(`${JSON.stringify({ path: audioPath, language })}\n`);
  });
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_AUDIO_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function extFromMime(mime: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return ".m4a";
  if (m.includes("ogg") || m.includes("opus")) return ".ogg";
  if (m.includes("wav")) return ".wav";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  return ".webm";
}

export async function handlePocketTranscribeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  parsedUrl: URL
): Promise<boolean> {
  if (parsedUrl.pathname !== "/api/pocket/transcribe") {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  if (method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin" });
    return true;
  }

  const authed = await verifyHermesSession(req, config);
  if (!authed) {
    sendJson(res, 401, { error: "unauthorized", detail: "Anmeldung bei Hermes erforderlich." });
    return true;
  }

  let rawBody: Buffer;
  let parsed: { data_url?: string; mime_type?: string; language?: string };
  try {
    rawBody = await readBody(req);
    parsed = JSON.parse(rawBody.toString("utf8")) as {
      data_url?: string;
      mime_type?: string;
      language?: string;
    };
  } catch {
    sendJson(res, 400, { error: "bad_request", detail: "Ungültige Audio-Daten." });
    return true;
  }

  const dataUrl = typeof parsed.data_url === "string" ? parsed.data_url.trim() : "";
  const commaIdx = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIdx === -1) {
    sendJson(res, 400, { error: "invalid_audio", detail: "Ungültiges Audio-Format." });
    return true;
  }

  const local = resolveLocalSttPaths();
  if (local) {
    const audioBytes = Buffer.from(dataUrl.slice(commaIdx + 1), "base64");
    const ext = extFromMime(parsed.mime_type || "audio/mp4");
    const tmpPath = path.join(os.tmpdir(), `hermes-stt-${crypto.randomBytes(8).toString("hex")}${ext}`);
    try {
      fs.writeFileSync(tmpPath, audioBytes, { mode: 0o600 });
      const result = await runLocalTranscribe(
        local.pythonBin,
        local.workerScript,
        tmpPath,
        parsed.language || "de"
      );
      if (result.ok) {
        sendJson(res, 200, {
          ok: true,
          transcript: result.transcript || "",
          provider: result.provider || "local-whisper",
        });
        return true;
      }
      sendJson(res, 502, { error: "stt_failed", detail: result.error || "Transkription fehlgeschlagen." });
      return true;
    } catch (err) {
      sendJson(res, 502, {
        error: "stt_failed",
        detail: err instanceof Error ? err.message : "Transkription fehlgeschlagen.",
      });
      return true;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }

  // Fallback to Hermes native /api/audio/transcribe
  try {
    const upstreamRes = await fetch(
      `${config.hermesBaseUrl}/api/audio/transcribe${parsedUrl.search}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(req.headers.cookie ? { Cookie: String(req.headers.cookie) } : {}),
        },
        body: new Uint8Array(rawBody),
      }
    );
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.writeHead(upstreamRes.status, {
      "Content-Type": upstreamRes.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  } catch {
    sendJson(res, 502, { error: "upstream_unreachable", detail: "Spracherkennung aktuell nicht erreichbar." });
  }
  return true;
}
