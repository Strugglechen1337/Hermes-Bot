/**
 * Lightweight per-bot chat draft persistence in `localStorage` so half-typed
 * messages survive switching between bots, tabs, or briefings.
 */

const DRAFT_PREFIX = "hermes-pocket.draft.v1:";

export function loadBotDraft(botName: string): string {
  const clean = botName.trim();
  if (!clean) return "";
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${clean}`) || "";
  } catch {
    return "";
  }
}

export function saveBotDraft(botName: string, text: string): void {
  const clean = botName.trim();
  if (!clean) return;
  try {
    if (text.trim()) {
      localStorage.setItem(`${DRAFT_PREFIX}${clean}`, text);
    } else {
      localStorage.removeItem(`${DRAFT_PREFIX}${clean}`);
    }
  } catch {
    // ignore storage errors
  }
}

export function loadAllBotDrafts(): Record<string, string> {
  const drafts: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_PREFIX)) {
        const botName = key.slice(DRAFT_PREFIX.length);
        const val = localStorage.getItem(key) || "";
        if (botName && val.trim()) {
          drafts[botName] = val.trim();
        }
      }
    }
  } catch {
    // ignore
  }
  return drafts;
}
