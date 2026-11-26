import type { HermesProfile, HermesSessionSummary } from "../../shared/types";
import { getBotVisual } from "./botTheme";

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
 * Selects the best existing session to display while offline or browsing history:
 * 1. Prefer the canonical "Bot Chat" session (which holds bot-to-bot DMs & `message_agent`).
 * 2. Otherwise pick the newest interactive local/gui session.
 * 3. Return null so the canonical "Bot Chat" is opened/created directly.
 */
export function pickPreferredBotSession(
  sessions: HermesSessionSummary[]
): HermesSessionSummary | null {
  const canonical = sessions.find((s) => (s.title || "").trim() === BOT_CHAT_TITLE);
  if (canonical) return canonical;
  const interactive = sessions.find((s) => !isBackgroundSession(s));
  return interactive || null;
}
