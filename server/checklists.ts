import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { getPushDataDir, verifyHermesSession } from "./push.js";
import { isSameOriginRequest } from "./security.js";

/**
 * Interactive Checklists (shopping lists, daily to-dos, packing lists)
 * persisted on the server (`.data/checklists.json`, mode 0600) so checked
 * state syncs across devices and survives reloads.
 */

export interface ChecklistItem {
  text: string;
  checked: boolean;
}

export interface StoredChecklist {
  id: string;
  title: string;
  items: ChecklistItem[];
  updatedAt: number;
}

export const CHECKLIST_ID_RE = /^[a-z0-9][a-z0-9_-]{1,79}$/;

function getChecklistsPath(): string {
  return path.join(getPushDataDir(), "checklists.json");
}

function loadAll(): Record<string, StoredChecklist> {
  const filePath = getChecklistsPath();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, StoredChecklist>;
      }
    }
  } catch {
    // ignore corrupt file
  }
  return {};
}

function saveAll(map: Record<string, StoredChecklist>): void {
  const dir = getPushDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = getChecklistsPath();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

export function getChecklist(id: string): StoredChecklist | null {
  if (!CHECKLIST_ID_RE.test(id)) return null;
  const map = loadAll();
  return map[id] || null;
}

export function upsertChecklist(
  id: string,
  title: string,
  items: ChecklistItem[]
): StoredChecklist {
  const cleanTitle = title.trim().slice(0, 120) || "Checkliste";
  const cleanItems = items
    .filter((i) => i && typeof i.text === "string" && i.text.trim())
    .slice(0, 80)
    .map((i) => ({
      text: i.text.trim().slice(0, 200),
      checked: Boolean(i.checked),
    }));

  const map = loadAll();
  const next: StoredChecklist = {
    id,
    title: cleanTitle,
    items: cleanItems,
    updatedAt: Date.now(),
  };
  map[id] = next;

  // Keep at most 100 most recent checklists
  const entries = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  const pruned: Record<string, StoredChecklist> = {};
  for (const entry of entries) pruned[entry.id] = entry;
  saveAll(pruned);
  return next;
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 64 * 1024) throw new Error("BODY_TOO_LARGE");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON");
  }
  return parsed as Record<string, unknown>;
}

export async function handlePocketChecklistsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith("/api/pocket/checklists/")) {
    return false;
  }

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "PUT") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (method === "PUT" && !isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "forbidden_origin" });
    return true;
  }

  const authenticated = await verifyHermesSession(req, config);
  if (!authenticated) {
    sendJson(res, 401, { error: "unauthorized", detail: "Anmeldung bei Hermes erforderlich." });
    return true;
  }

  const id = pathname.slice("/api/pocket/checklists/".length).trim().toLowerCase();
  if (!CHECKLIST_ID_RE.test(id)) {
    sendJson(res, 400, { error: "invalid_checklist_id" });
    return true;
  }

  if (method === "GET") {
    const found = getChecklist(id);
    if (!found) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    sendJson(res, 200, { ok: true, checklist: found });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "bad_request" });
    return true;
  }

  const title = typeof body.title === "string" ? body.title : "Checkliste";
  const items = Array.isArray(body.items) ? (body.items as ChecklistItem[]) : [];
  const saved = upsertChecklist(id, title, items);
  sendJson(res, 200, { ok: true, checklist: saved });
  return true;
}
