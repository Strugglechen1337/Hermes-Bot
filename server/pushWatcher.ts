import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  dispatchPushNotification,
  getPushBlockReason,
  hasActivePushSubscriptions,
  isClientCurrentlyForeground,
  recordBotPushSent,
  wasBotPushedRecently,
} from "./push.js";

const execFileAsync = promisify(execFile);

export interface WatchedDbMessageRow {
  id: number;
  session_id?: string | null;
  role: string;
  content: string | null;
  timestamp?: number | null;
  session_source?: string | null;
  session_title?: string | null;
  prev_user_content?: string | null;
}

export interface WatchedRoomEventRow {
  rowid: number;
  room_id: string;
  room_name?: string | null;
  kind?: string | null;
  actor_json?: string | null;
  payload_json?: string | null;
}

export interface PushWatcherOptions {
  hermesHome?: string;
  pollIntervalMs?: number;
  queryDb?: (dbPath: string, sql: string) => Promise<WatchedDbMessageRow[]>;
  queryRoomEvents?: (dbPath: string, sql: string) => Promise<WatchedRoomEventRow[]>;
  dispatch?: typeof dispatchPushNotification;
}

interface ProfileDbTarget {
  profileName: string;
  displayName: string;
  dbPath: string;
}

interface WatchedProfileState {
  lastMtimeMs: number;
  lastSeenId: number;
  lastSeenRoomRowId: number;
  seeded: boolean;
}

function defaultDisplayName(profileName: string, profileDir?: string): string {
  if (profileName === "default") return "Hermes";
  if (profileDir) {
    try {
      const yamlPath = path.join(profileDir, "profile.yaml");
      if (fs.existsSync(yamlPath)) {
        const text = fs.readFileSync(yamlPath, "utf8");
        const titleMatch = text.match(/hermes-bots[\s\S]{0,160}?\btitle\s*:\s*["']?([^"'\r\n#]+)["']?/m);
        if (titleMatch?.[1]?.trim()) {
          return titleMatch[1].trim();
        }
        const match = text.match(/^\s*display_name\s*:\s*["']?([^"'\r\n#]+)["']?/m);
        if (match?.[1]?.trim()) {
          return match[1].trim();
        }
      }
    } catch {
      // fallback to formatted profile name
    }
  }
  const firstSegment = profileName.split(/[-_]/)[0] || profileName;
  return firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1);
}

export function discoverHermesProfileDbs(hermesHome: string): ProfileDbTarget[] {
  const targets: ProfileDbTarget[] = [];
  const defaultDb = path.join(hermesHome, "state.db");
  if (fs.existsSync(defaultDb)) {
    targets.push({
      profileName: "default",
      displayName: "Hermes",
      dbPath: defaultDb,
    });
  }

  const profilesDir = path.join(hermesHome, "profiles");
  if (fs.existsSync(profilesDir)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(profilesDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith(".") || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) continue;
      const profileDir = path.join(profilesDir, name);
      const dbPath = path.join(profileDir, "state.db");
      if (fs.existsSync(dbPath)) {
        targets.push({
          profileName: name,
          displayName: defaultDisplayName(name, profileDir),
          dbPath,
        });
      }
    }
  }
  return targets;
}

function getDbMtimeMs(dbPath: string): number {
  let latest = 0;
  try {
    latest = Math.max(latest, fs.statSync(dbPath).mtimeMs);
  } catch {
    return 0;
  }
  for (const suffix of ["-wal", "-shm"]) {
    try {
      latest = Math.max(latest, fs.statSync(`${dbPath}${suffix}`).mtimeMs);
    } catch {
      // optional WAL/SHM file
    }
  }
  return latest;
}

async function defaultQuerySqlite(dbPath: string, sql: string): Promise<WatchedDbMessageRow[]> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-readonly", "-json", dbPath, sql],
      { timeout: 3000, maxBuffer: 512 * 1024 }
    );
    const trimmed = (stdout || "").trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? (parsed as WatchedDbMessageRow[]) : [];
  } catch {
    return [];
  }
}

function isIncomingBotToBotDmText(rawText: string | null | undefined): boolean {
  const text = (rawText || "").trim();
  if (!text) return false;
  if (/^Message from\s+(?:🤖\s*)?[^:\n]{1,60}\(@[a-zA-Z0-9_-]+\)\s*:/i.test(text)) return true;
  if (/^\[(?:Direct message|DM|Bot-zu-Bot|From\s+@)/i.test(text)) return true;
  if (/"is_bot"\s*:\s*true/i.test(text)) return true;
  return false;
}

export function isNonNotifiableAssistantMessage(row: WatchedDbMessageRow): boolean {
  const source = (row.session_source || "").trim().toLowerCase();
  const title = (row.session_title || "").trim().toLowerCase();
  // Skip internal subagent sessions and isolated cron-only sessions (cron outputs
  // are delivered into the interactive Bot Chat as `Cronjob Response:` messages
  // where the user can actually see and reply to them).
  if (source === "subagent" || source === "cron" || title.startsWith("subagent:")) {
    return true;
  }

  const text = (row.content || "").trim();
  if (!text) return true;

  // User-role rows are only notifiable when they are delivered Cronjob Responses in Bot Chat
  if (row.role === "user") {
    return !/^Cronjob Response:\s*/i.test(text);
  }

  if (/^(?:\[SILENT\]|NO_REPLY)$/i.test(text)) return true;
  if (/^\[IMPORTANT:\s*Background process\b/i.test(text)) return true;
  if (/^\[ASYNC DELEGATION\b/i.test(text)) return true;
  if (/\[INTERNAL NOTIFICATION\s*[—–-]\s*generated by the Hermes gateway\b/i.test(text)) return true;
  if (/\bbot_mode_dm\.py\b/i.test(text) && /--run-delivery|--author/i.test(text)) return true;
  if (/\{"outcome"\s*:\s*"Your teammate answered\."/i.test(text)) return true;

  // Replies triggered by an incoming bot-to-bot DM (e.g. Nina answering Mia)
  // are internal teammate chatter, not direct answers to the human user.
  if (
    isIncomingBotToBotDmText(row.prev_user_content) &&
    !/\[(?:POCKET_PAGE|PACKAGE_CARD|DEAL_CARD):/i.test(text)
  ) {
    return true;
  }

  // Reaction-only assistant turns (e.g. "[REACT: 👍]") should not trigger a push banner
  const withoutReactions = text.replace(/\[REACT:\s*[^\]]+\]/gi, "").trim();
  if (!withoutReactions) return true;

  return false;
}

export function formatPushPreview(rawText: string, maxLen = 160): string {
  // Strip Hermes Cronjob Response header/footer if present
  const unwrapped = (rawText || "")
    .replace(/^Cronjob Response:\s*[^\r\n]+\r?\n(?:\(job_id:\s*[^)]+\)\r?\n)?[-─]{3,}\s*\r?\n+/i, "")
    .replace(/\r?\n*To stop or manage this job,[\s\S]*$/i, "");

  const hasMedia = /(?:^|\s)MEDIA:\s*\/[^\s\r\n]+/i.test(unwrapped);
  const hasPage = /\[POCKET_PAGE:[^\]]+\]/i.test(unwrapped);
  const hasPackage = /\[PACKAGE_CARD:[^\]]+\]/i.test(unwrapped);

  const cleaned = unwrapped
    .replace(/\[(?:POCKET_PAGE|PACKAGE_CARD|DEAL_CARD|SECRET_REQUEST|CHECKLIST|CHOICE_CARD|REACT):[^\]]*\]/gi, " ")
    .replace(/(?:^|\s)MEDIA:\s*\/[^\s\r\n]+/gi, " ")
    .replace(/```[\s\S]*?```/g, "[Code]")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    if (hasMedia) return "Neues Bild gesendet";
    if (hasPage) return "Neues Briefing erstellt";
    if (hasPackage) return "Neues Paket-Update";
    return "Neue Nachricht";
  }
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

async function defaultQueryRoomSqlite(dbPath: string, sql: string): Promise<WatchedRoomEventRow[]> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-readonly", "-json", dbPath, sql],
      { timeout: 3000, maxBuffer: 512 * 1024 }
    );
    const trimmed = (stdout || "").trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? (parsed as WatchedRoomEventRow[]) : [];
  } catch {
    return [];
  }
}

export function extractGroupEventNotification(
  row: WatchedRoomEventRow
): { roomId: string; roomName: string; senderLabel: string; preview: string } | null {
  if (!row.room_id) return null;
  if (row.kind && row.kind !== "message" && row.kind !== "chat.message") return null;

  let actor: Record<string, unknown> = {};
  if (row.actor_json) {
    try {
      const parsed = JSON.parse(row.actor_json) as unknown;
      if (parsed && typeof parsed === "object") actor = parsed as Record<string, unknown>;
    } catch {
      // ignore malformed json
    }
  }
  const actorKind = String(actor.kind || actor.type || actor.role || "").toLowerCase();
  if (actorKind === "user" || actorKind === "human" || actor.is_human === true) {
    return null;
  }

  let payload: Record<string, unknown> = {};
  if (row.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
    } catch {
      // ignore malformed json
    }
  }
  const rawText =
    (typeof payload.text === "string" && payload.text) ||
    (typeof payload.body === "string" && payload.body) ||
    (typeof payload.content === "string" && payload.content) ||
    "";
  const trimmed = rawText.trim();
  if (!trimmed || /^(?:\[SILENT\]|NO_REPLY)$/i.test(trimmed)) return null;

  const senderRaw =
    (typeof actor.display_name === "string" && actor.display_name) ||
    (typeof actor.name === "string" && actor.name) ||
    (typeof actor.profile === "string" && actor.profile) ||
    "Bot";
  const senderLabel = senderRaw.trim().split(/[-_]/)[0];
  const formattedSender = senderLabel.charAt(0).toUpperCase() + senderLabel.slice(1);
  const roomName = (row.room_name || "").trim() || "Gruppe";

  return {
    roomId: row.room_id,
    roomName,
    senderLabel: formattedSender,
    preview: formatPushPreview(trimmed, 140),
  };
}

/**
 * Watches Hermes profile SQLite databases (read-only, mtime-gated) and dispatches
 * Web Push notifications when a bot finishes a reply while the user's app is
 * backgrounded or locked on iOS.
 */
export function startHermesPushWatcher(options: PushWatcherOptions = {}): {
  stop: () => void;
  pollOnce: () => Promise<number>;
} {
  const hermesHome =
    options.hermesHome?.trim() ||
    process.env.HERMES_HOME?.trim() ||
    path.join(os.homedir(), ".hermes");
  const pollIntervalMs = options.pollIntervalMs ?? 4_000;
  const queryDb = options.queryDb ?? defaultQuerySqlite;
  const queryRoomEvents = options.queryRoomEvents ?? defaultQueryRoomSqlite;
  const dispatch = options.dispatch ?? dispatchPushNotification;

  const states = new Map<string, WatchedProfileState>();
  let running = false;
  let stopped = false;

  const pollOnce = async (): Promise<number> => {
    if (running || stopped) return 0;
    running = true;
    let pushedCount = 0;

    try {
      const targets = discoverHermesProfileDbs(hermesHome);
      for (const target of targets) {
        const mtimeMs = getDbMtimeMs(target.dbPath);
        if (!mtimeMs) continue;

        const state = states.get(target.profileName);

        // First observation of this profile DB: seed high-water mark without sending old pushes
        if (!state || !state.seeded) {
          const rows = await queryDb(
            target.dbPath,
            "SELECT COALESCE(MAX(id), 0) AS id, 'system' AS role, '' AS content FROM messages;"
          );
          const maxId = Number(rows[0]?.id || 0);
          let maxRoomRowId = 0;
          if (target.profileName === "default") {
            const roomSeed = await queryRoomEvents(
              target.dbPath,
              "SELECT COALESCE(MAX(rowid), 0) AS rowid, '' AS room_id FROM hosted_room_events;"
            );
            maxRoomRowId = Number(roomSeed[0]?.rowid || 0);
          }
          states.set(target.profileName, {
            lastMtimeMs: mtimeMs,
            lastSeenId: Number.isFinite(maxId) ? maxId : 0,
            lastSeenRoomRowId: Number.isFinite(maxRoomRowId) ? maxRoomRowId : 0,
            seeded: true,
          });
          continue;
        }

        // Fast path: skip sqlite3 subprocess entirely if DB and WAL haven't been touched
        if (mtimeMs <= state.lastMtimeMs) {
          continue;
        }
        state.lastMtimeMs = mtimeMs;

        const safeLastId = Math.max(0, Math.floor(state.lastSeenId));
        const rows = await queryDb(
          target.dbPath,
          `SELECT m.id, m.session_id, m.role, m.content, m.timestamp, s.source AS session_source, s.title AS session_title, (SELECT u.content FROM messages u WHERE u.session_id = m.session_id AND u.role = 'user' AND u.id < m.id ORDER BY u.id DESC LIMIT 1) AS prev_user_content FROM messages m LEFT JOIN sessions s ON s.id = m.session_id WHERE m.id > ${safeLastId} AND (m.role = 'assistant' OR (m.role = 'user' AND m.content LIKE 'Cronjob Response:%')) ORDER BY m.id ASC LIMIT 20;`
        );
        if (rows.length > 0) {
          let maxId = state.lastSeenId;
          const candidates: WatchedDbMessageRow[] = [];
          for (const row of rows) {
            const rowId = Number(row.id || 0);
            if (rowId > maxId) maxId = rowId;
            if (!isNonNotifiableAssistantMessage(row)) {
              candidates.push(row);
            }
          }
          state.lastSeenId = maxId;

          if (
            candidates.length > 0 &&
            hasActivePushSubscriptions() &&
            !isClientCurrentlyForeground() &&
            getPushBlockReason(target.profileName) === null &&
            !wasBotPushedRecently(target.profileName, 20_000)
          ) {
            const latest = candidates[candidates.length - 1];
            const preview = formatPushPreview(latest.content || "");
            const targetSession = (latest.session_id || "").trim();
            const deepLinkUrl = targetSession
              ? `/?bot=${encodeURIComponent(target.profileName)}&session=${encodeURIComponent(targetSession)}`
              : `/?bot=${encodeURIComponent(target.profileName)}`;
            const stats = await dispatch({
              title: target.displayName,
              body: preview,
              bot: target.profileName,
              tag: `hermes-bot-${target.profileName}`,
              url: deepLinkUrl,
            });
            if (stats.sent > 0) {
              recordBotPushSent(target.profileName);
              pushedCount += 1;
              console.log(
                `[hermes-pocket] Push watcher dispatched notification for ${target.profileName} (sent=${stats.sent})`
              );
            }
          }
        }

        // Also check hosted group room events on the authority DB ("default")
        if (target.profileName === "default") {
          const safeRoomRowId = Math.max(0, Math.floor(state.lastSeenRoomRowId));
          const roomRows = await queryRoomEvents(
            target.dbPath,
            `SELECT e.rowid AS rowid, e.room_id AS room_id, r.name AS room_name, e.kind AS kind, e.actor_json AS actor_json, e.payload_json AS payload_json FROM hosted_room_events e LEFT JOIN hosted_rooms r ON r.room_id = e.room_id WHERE e.rowid > ${safeRoomRowId} ORDER BY e.rowid ASC LIMIT 20;`
          );
          if (roomRows.length > 0) {
            let maxRoomRow = state.lastSeenRoomRowId;
            let latestGroupNotif: ReturnType<typeof extractGroupEventNotification> = null;
            for (const rRow of roomRows) {
              const rid = Number(rRow.rowid || 0);
              if (rid > maxRoomRow) maxRoomRow = rid;
              const extracted = extractGroupEventNotification(rRow);
              if (extracted) latestGroupNotif = extracted;
            }
            state.lastSeenRoomRowId = maxRoomRow;

            if (
              latestGroupNotif &&
              hasActivePushSubscriptions() &&
              !isClientCurrentlyForeground() &&
              !wasBotPushedRecently(`group:${latestGroupNotif.roomId}`, 10_000)
            ) {
              const stats = await dispatch({
                title: latestGroupNotif.roomName,
                body: `${latestGroupNotif.senderLabel}: ${latestGroupNotif.preview}`,
                tag: `hermes-group-${latestGroupNotif.roomId}`,
                url: `/?tab=groups&room=${encodeURIComponent(latestGroupNotif.roomId)}`,
              });
              if (stats.sent > 0) {
                recordBotPushSent(`group:${latestGroupNotif.roomId}`);
                pushedCount += 1;
                console.log(
                  `[hermes-pocket] Push watcher dispatched group notification for ${latestGroupNotif.roomId} (sent=${stats.sent})`
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(
        "[hermes-pocket] Push watcher poll error:",
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      running = false;
    }

    return pushedCount;
  };

  // Seed baselines immediately on startup, then poll on interval
  void pollOnce();
  const timer = setInterval(() => {
    void pollOnce();
  }, pollIntervalMs);
  timer.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    pollOnce,
  };
}
