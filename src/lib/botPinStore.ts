import type { HermesProfile } from "../../shared/types";

const CHIEF_BOT_KEY = "hermes-pocket.chiefBot.v1";
const PINNED_BOTS_KEY = "hermes-pocket.pinnedBots.v1";

export function loadChiefBot(): string | null {
  try {
    const raw = localStorage.getItem(CHIEF_BOT_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function saveChiefBot(profileName: string | null): void {
  try {
    if (profileName && profileName.trim()) {
      localStorage.setItem(CHIEF_BOT_KEY, profileName.trim());
    } else {
      localStorage.removeItem(CHIEF_BOT_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function loadPinnedBots(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_BOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      : [];
  } catch {
    return [];
  }
}

export function savePinnedBots(names: string[]): void {
  try {
    const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
    localStorage.setItem(PINNED_BOTS_KEY, JSON.stringify(unique));
  } catch {
    // ignore storage errors
  }
}

export function getPocketUiMeta(profile: HermesProfile): Record<string, unknown> {
  const pocket = profile.ui_meta?.["hermes-pocket"];
  if (pocket && typeof pocket === "object" && !Array.isArray(pocket)) {
    return { ...(pocket as Record<string, unknown>) };
  }
  return {};
}

/**
 * Resolves the active Chief bot name from local preference or Hermes `ui_meta`
 * (so Chief selection syncs cleanly across devices). Only returns a bot present
 * in the visible `publicProfiles` list.
 */
export function resolveChiefBotName(
  publicProfiles: HermesProfile[],
  localChief: string | null
): string | null {
  const available = new Set(publicProfiles.map((p) => p.name));
  if (localChief && available.has(localChief)) {
    return localChief;
  }
  const fromMeta = publicProfiles.find((p) => getPocketUiMeta(p).chief === true);
  return fromMeta ? fromMeta.name : null;
}

/**
 * Resolves additional pinned showcase bots (excluding the Chief, who always
 * sits first in the showcase row).
 */
export function resolvePinnedBotNames(
  publicProfiles: HermesProfile[],
  localPinned: string[],
  chiefName: string | null,
  maxPinned = 3
): string[] {
  const available = new Set(publicProfiles.map((p) => p.name));
  const out: string[] = [];

  for (const name of localPinned) {
    if (name !== chiefName && available.has(name) && !out.includes(name)) {
      out.push(name);
    }
  }
  for (const p of publicProfiles) {
    if (
      p.name !== chiefName &&
      getPocketUiMeta(p).pinned === true &&
      !out.includes(p.name)
    ) {
      out.push(p.name);
    }
  }
  return out.slice(0, maxPinned);
}
