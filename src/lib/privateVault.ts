import type { HermesProfile } from "../../shared/types";

const PIN_STORAGE_KEY = "hermes-pocket.privateVaultPinHash";
const LOCAL_PRIVATE_LIST_KEY = "hermes-pocket.privateProfiles";

export const PRIVATE_CHAT_TITLE = "Privater Chat";

/**
 * Checks whether a Hermes profile is marked private — either via synced
 * Hermes `profile.yaml` (`ui_meta["hermes-pocket"].private`) OR local fallback.
 */
export function isProfilePrivate(
  profile: HermesProfile,
  localPrivateNames: string[] = []
): boolean {
  if (profile.is_default || profile.name === "default") return false;
  const meta = profile.ui_meta?.["hermes-pocket"];
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).private === true) {
    return true;
  }
  return localPrivateNames.includes(profile.name);
}

export function loadLocalPrivateProfiles(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_PRIVATE_LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x !== "default")
      : [];
  } catch {
    return [];
  }
}

export function saveLocalPrivateProfiles(names: string[]): void {
  try {
    const cleaned = Array.from(new Set(names.filter((n) => n && n !== "default")));
    localStorage.setItem(LOCAL_PRIVATE_LIST_KEY, JSON.stringify(cleaned));
  } catch {
    // ignore storage errors
  }
}

export function getStoredVaultPinHash(): string | null {
  try {
    const val = localStorage.getItem(PIN_STORAGE_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function hydrateVaultPinHash(hash: string | null): void {
  try {
    if (hash && hash.trim()) {
      localStorage.setItem(PIN_STORAGE_KEY, hash.trim());
    } else {
      localStorage.removeItem(PIN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function hasVaultPin(): boolean {
  return Boolean(getStoredVaultPinHash());
}

export function clearVaultPin(): void {
  try {
    localStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    // ignore
  }
  if (typeof fetch === "function") {
    void fetch("/api/pocket/preferences", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPinHash: null }),
    }).catch(() => null);
  }
}

export async function hashVaultPin(pin: string): Promise<string> {
  const normalized = pin.trim();
  const data = new TextEncoder().encode(`hermes-pocket-vault-v1:${normalized}`);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Deterministic fallback for non-secure test contexts
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

export async function setVaultPin(pin: string): Promise<void> {
  const hashed = await hashVaultPin(pin);
  try {
    localStorage.setItem(PIN_STORAGE_KEY, hashed);
  } catch {
    // ignore
  }
  if (typeof fetch === "function") {
    void fetch("/api/pocket/preferences", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPinHash: hashed }),
    }).catch(() => null);
  }
}

export async function verifyVaultPin(pin: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(PIN_STORAGE_KEY);
    if (!stored) return true;
    const candidate = await hashVaultPin(pin);
    return candidate === stored;
  } catch {
    return false;
  }
}

/**
 * Strips raw HTML tags (like SQLite FTS `<mark>` tags) cleanly into plain display text.
 */
export function cleanSearchSnippet(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
