import type { HermesProfile, HermesSessionSummary } from "../../shared/types";
import { getBotVisual } from "./botTheme";
import { toTimestampMs } from "./format";

/**
 * Exact canonical session title gated by Hermes `tools/bot_mode_probe.py`
 * and `tools/bot_mode_dm.py` to inject the live teammate roster and the
 * `message_agent` bot-to-bot tool automatically.
 */
export const BOT_CHAT_TITLE = "Bot Chat";

/**
 * Computes the canonical @handle matching Hermes `bot_mode_probe._handle`:
 * `default` answers to `@hermes` unless a real `profiles/hermes` exists.
 */
export function getBotHandle(profileName: string, allProfileNames: string[]): string {
  if (profileName === "default" && !allProfileNames.includes("hermes")) {
    return "hermes";
  }
  return profileName;
}

/**
 * Derives a clean, natural call name (without @ or role suffix) for Hermes
 * `ui_meta["hermes-bots"].title` so bots recognize natural names like "Clara",
 * "Anna", "Nina", or "Mika" in plain sentences without needing "@clara-it".
 */
export function deriveShortBotCallName(rawName: string): string {
  const cleaned = rawName.trim();
  if (!cleaned) return "";
  if (cleaned.toLowerCase() === "default") return "Hermes";
  // Split on hyphen/underscore/whitespace: "Clara-it" -> "Clara", "Anna Coding" -> "Anna"
  const firstToken = cleaned.split(/[-_\s]+/).filter(Boolean)[0] || cleaned;
  return firstToken.charAt(0).toUpperCase() + firstToken.slice(1);
}

export interface HermesGroupMemberInput {
  member_id: string;
  profile: string;
  handle: string;
  display_name: string;
  target: { kind: "local"; profile: string };
}

/**
 * Builds the exact `groups.create` `members` payload required by Hermes
 * `gateway/hosted_room_discussion.py::_validate_member`.
 */
export function buildGroupMembersPayload(
  selectedProfiles: string[],
  allProfiles: HermesProfile[]
): HermesGroupMemberInput[] {
  const allNames = allProfiles.map((p) => p.name);
  return selectedProfiles.map((name) => {
    const profile = allProfiles.find((p) => p.name === name);
    const visual = profile ? getBotVisual(profile) : null;
    const handle = getBotHandle(name, allNames);
    return {
      member_id: handle,
      profile: name,
      handle,
      display_name: visual?.label || name,
      target: { kind: "local", profile: name },
    };
  });
}

function isBackgroundSession(session: HermesSessionSummary): boolean {
  const src = (session.source || "").toLowerCase();
  if (src === "subagent" || src === "oneshot" || src === "cron" || src === "telegram" || src === "discord" || src === "slack") {
    return true;
  }
  const title = (session.title || "").trim().toLowerCase();
  if (title.startsWith("subagent:")) return true;
  return false;
}

/**
 * Selects the most up-to-date interactive session for a bot:
 * 1. Sort interactive sessions strictly newest-first by `last_active` / `started_at`.
 * 2. Prefer the newest interactive session (so newly started chats are never
 *    replaced by an older "Bot Chat" when leaving and re-entering).
 * 3. Fall back to canonical "Bot Chat" if timestamps tie or are missing.
 */
export function pickPreferredBotSession(
  sessions: HermesSessionSummary[]
): HermesSessionSummary | null {
  const interactive = sessions.filter((s) => !isBackgroundSession(s));
  if (interactive.length === 0) return null;

  const sorted = [...interactive].sort((a, b) => {
    const ta = toTimestampMs(a.last_active) ?? toTimestampMs(a.started_at) ?? 0;
    const tb = toTimestampMs(b.last_active) ?? toTimestampMs(b.started_at) ?? 0;
    if (tb !== ta) return tb - ta;
    const aCanon = (a.title || "").trim() === BOT_CHAT_TITLE ? 1 : 0;
    const bCanon = (b.title || "").trim() === BOT_CHAT_TITLE ? 1 : 0;
    return bCanon - aCanon;
  });

  return sorted[0] || null;
}
