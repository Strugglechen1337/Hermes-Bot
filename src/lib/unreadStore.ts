import type {
  HermesChatMessage,
  HermesRoom,
  HermesSessionSummary,
} from "../../shared/types";
import { BOT_CHAT_TITLE } from "./botCollaboration";
import { toTimestampMs } from "./format";
import { PRIVATE_CHAT_TITLE } from "./privateVault";
import { stripSecretRequestTag } from "./secretDetection";

export interface BotReadCursor {
  sessionId: string;
  lastActiveMs: number;
  messageCount: number;
  readAtMs: number;
}

export interface BotUnreadInfo {
  count: number;
  latestTimestampMs: number;
  preview?: string;
  sessionId?: string;
  source?: "ws" | "poll" | "push";
}

export interface GroupReadCursor {
  latestSeq: number;
  updatedAtMs: number;
}

export interface GroupUnreadInfo {
  count: number;
  latestSeq: number;
  latestTimestampMs: number;
}

const BOT_CURSORS_KEY = "hermes-pocket.botReadCursors.v1";
const GROUP_CURSORS_KEY = "hermes-pocket.groupReadCursors.v1";

export function loadBotReadCursors(): Record<string, BotReadCursor> {
  try {
    const raw = localStorage.getItem(BOT_CURSORS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, BotReadCursor> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const rec = v as Record<string, unknown>;
      out[k] = {
        sessionId: typeof rec.sessionId === "string" ? rec.sessionId : "",
        lastActiveMs: typeof rec.lastActiveMs === "number" && Number.isFinite(rec.lastActiveMs) ? rec.lastActiveMs : 0,
        messageCount: typeof rec.messageCount === "number" && Number.isFinite(rec.messageCount) ? rec.messageCount : 0,
        readAtMs: typeof rec.readAtMs === "number" && Number.isFinite(rec.readAtMs) ? rec.readAtMs : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveBotReadCursors(cursors: Record<string, BotReadCursor>): void {
  try {
    localStorage.setItem(BOT_CURSORS_KEY, JSON.stringify(cursors));
  } catch {
    // ignore storage errors
  }
}

export function loadGroupReadCursors(): Record<string, GroupReadCursor> {
  try {
    const raw = localStorage.getItem(GROUP_CURSORS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, GroupReadCursor> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const rec = v as Record<string, unknown>;
      out[k] = {
        latestSeq: typeof rec.latestSeq === "number" && Number.isFinite(rec.latestSeq) ? rec.latestSeq : 0,
        updatedAtMs: typeof rec.updatedAtMs === "number" && Number.isFinite(rec.updatedAtMs) ? rec.updatedAtMs : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveGroupReadCursors(cursors: Record<string, GroupReadCursor>): void {
  try {
    localStorage.setItem(GROUP_CURSORS_KEY, JSON.stringify(cursors));
  } catch {
    // ignore storage errors
  }
}

function isInternalSubagentSession(session: HermesSessionSummary): boolean {
  const src = (session.source || "").toLowerCase();
  if (src === "subagent") return true;
  const title = (session.title || "").trim().toLowerCase();
  return title.startsWith("subagent:");
}

/**
 * Picks the primary session to watch for a bot's incoming messages:
 * 1. Canonical "Bot Chat" (or "Privater Chat" for private bots) if present.
 * 2. Otherwise the newest non-subagent session.
 * 3. Fallback to the first session if only subagent sessions exist.
 */
export function pickSessionForUnreadCheck(
  sessions: HermesSessionSummary[],
  isPrivateBot = false
): HermesSessionSummary | null {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const canonicalTitle = isPrivateBot ? PRIVATE_CHAT_TITLE : BOT_CHAT_TITLE;
  const canonical = sessions.find((s) => (s.title || "").trim() === canonicalTitle);
  if (canonical) return canonical;
  const nonSubagent = sessions.find((s) => !isInternalSubagentSession(s));
  return nonSubagent || sessions[0] || null;
}

export function extractSessionMetrics(session: HermesSessionSummary): {
  sessionId: string;
  lastActiveMs: number;
  messageCount: number;
} {
  const sessionId = session.id || session.session_id || "";
  const lastActiveMs = toTimestampMs(session.last_active ?? session.started_at) ?? 0;
  const messageCount =
    typeof session.message_count === "number" && Number.isFinite(session.message_count)
      ? session.message_count
      : 0;
  return { sessionId, lastActiveMs, messageCount };
}

export function buildReadCursorFromSession(
  session: HermesSessionSummary | null,
  messages?: HermesChatMessage[],
  nowMs = Date.now()
): BotReadCursor | null {
  if (!session && (!messages || messages.length === 0)) return null;
  const metrics = session
    ? extractSessionMetrics(session)
    : { sessionId: "", lastActiveMs: 0, messageCount: 0 };

  let latestMsgMs = metrics.lastActiveMs;
  if (messages && messages.length > 0) {
    for (const msg of messages) {
      const ts = toTimestampMs(msg.timestamp);
      if (ts !== null && ts > latestMsgMs) {
        latestMsgMs = ts;
      }
    }
  }

  const countedMsgs = messages
    ? messages.filter((m) => m.role === "user" || m.role === "assistant").length
    : 0;

  return {
    sessionId: metrics.sessionId,
    lastActiveMs: latestMsgMs,
    messageCount: Math.max(metrics.messageCount, countedMsgs),
    readAtMs: nowMs,
  };
}

/**
 * Determines whether a polled session summary indicates potential new activity
 * strictly after the stored read cursor. Returns `false` when no baseline cursor
 * exists yet (first observation seeds the baseline without false unread badges).
 */
export function hasSessionNewActivity(
  session: HermesSessionSummary,
  cursor: BotReadCursor | undefined
): boolean {
  if (!cursor) return false;
  const metrics = extractSessionMetrics(session);
  if (!metrics.sessionId) return false;

  if (cursor.sessionId && metrics.sessionId !== cursor.sessionId) {
    // Switched to a newer session (e.g. proactive/new conversation)
    return metrics.lastActiveMs > cursor.lastActiveMs + 1000;
  }

  if (metrics.messageCount > 0 && cursor.messageCount > 0 && metrics.messageCount > cursor.messageCount) {
    return true;
  }
  if (metrics.messageCount > 0 && cursor.messageCount === 0 && metrics.lastActiveMs > cursor.lastActiveMs + 1000) {
    return true;
  }
  return metrics.lastActiveMs > cursor.lastActiveMs + 1000;
}

/**
 * Strips markdown & secret tags into a compact single-line preview suitable
 * for bot list rows and floating notifications.
 */
export function formatUnreadPreview(rawText: string, maxLen = 110): string {
  const cleaned = stripSecretRequestTag(rawText || "")
    .replace(/```[\s\S]*?```/g, "[Code]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Neue Nachricht";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

export function isSilentBotAck(text: string | null | undefined): boolean {
  return /^(?:\[SILENT\]|NO_REPLY)$/i.test((text || "").trim());
}

/**
 * Inspects normalized messages from a session that had new activity and confirms
 * that the bot (assistant) actually sent a new message (preventing false positives
 * when only a user message was sent).
 */
export function detectUnreadAssistantMessages(
  messages: HermesChatMessage[],
  cursor: BotReadCursor | undefined,
  fallbackTimestampMs: number,
  sessionId?: string
): BotUnreadInfo | null {
  const turns = messages.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      !m.streaming &&
      Boolean(m.content?.trim() || m.error) &&
      !(m.role === "assistant" && !m.error && isSilentBotAck(m.content))
  );
  if (turns.length === 0) return null;

  const latest = turns[turns.length - 1];
  if (latest.role !== "assistant") {
    return null;
  }

  const latestTs = toTimestampMs(latest.timestamp) ?? fallbackTimestampMs;
  const baselineTs = cursor?.lastActiveMs ?? 0;

  // Count assistant messages strictly newer than the read cursor (or trailing assistant turns)
  let unreadCount = 0;
  if (baselineTs > 0) {
    for (let i = turns.length - 1; i >= 0; i--) {
      const m = turns[i];
      const ts = toTimestampMs(m.timestamp);
      if (ts !== null && ts <= baselineTs + 1000) break;
      if (m.role === "assistant") unreadCount += 1;
    }
  }
  if (unreadCount === 0) {
    // Fallback when timestamps are missing or identical: count trailing assistant messages since last user turn
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "assistant") {
        unreadCount += 1;
      } else {
        break;
      }
    }
  }

  return {
    count: Math.max(1, unreadCount),
    latestTimestampMs: latestTs,
    preview: formatUnreadPreview(latest.content || latest.error || ""),
    sessionId,
    source: "poll",
  };
}

export function detectGroupUnread(
  room: HermesRoom,
  cursor: GroupReadCursor | undefined
): GroupUnreadInfo | null {
  if (!cursor) return null;
  const latestSeq = typeof room.latest_seq === "number" ? room.latest_seq : 0;
  if (latestSeq > cursor.latestSeq) {
    return {
      count: Math.max(1, latestSeq - cursor.latestSeq),
      latestSeq,
      latestTimestampMs: toTimestampMs(room.updated_at) ?? Date.now(),
    };
  }
  return null;
}

export function formatBadgeCount(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
