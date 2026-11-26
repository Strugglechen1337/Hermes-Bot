import { hermesWs } from "./hermesWs";

export type VaultItemKind = "payment" | "address" | "login";

export interface VaultItemMeta {
  id: string;
  kind: VaultItemKind;
  label: string;
  origin?: string | null;
  identifier?: string | null;
  identifier_type?: "email" | "phone" | "username" | null;
  created_at?: string;
  backend?: string;
}

export interface VaultAddPayload {
  kind: VaultItemKind;
  label: string;
  origin?: string;
  secret: Record<string, string>;
}

/**
 * Derives a human-readable, non-sensitive card label (brand + last 4 digits only),
 * e.g. "Visa ••2315". Never returns or exposes full card numbers.
 */
export function buildSafeCardLabel(cardNumber: string, customLabel?: string): string {
  const custom = (customLabel || "").trim();
  const digits = cardNumber.replace(/\D+/g, "");
  const last4 = digits.length >= 4 ? digits.slice(-4) : "";
  let brand = "Karte";
  if (/^4/.test(digits)) brand = "Visa";
  else if (/^(5[1-5]|2[2-7])/.test(digits)) brand = "Mastercard";
  else if (/^3[47]/.test(digits)) brand = "Amex";

  if (custom) {
    return last4 && !custom.includes(last4) ? `${custom} ••${last4}` : custom;
  }
  return last4 ? `${brand} ••${last4}` : brand;
}

export async function listVaultItems(profile: string): Promise<VaultItemMeta[]> {
  const res = await hermesWs.call<{ items?: VaultItemMeta[] }>("vault.list", {
    ...(profile && profile !== "default" ? { profile } : {}),
  });
  return Array.isArray(res?.items) ? res.items : [];
}

export async function addVaultItem(
  profile: string,
  payload: VaultAddPayload
): Promise<{ id: string }> {
  const res = await hermesWs.call<{ id: string }>("vault.add", {
    ...(profile && profile !== "default" ? { profile } : {}),
    kind: payload.kind,
    label: payload.label,
    ...(payload.origin ? { origin: payload.origin } : {}),
    secret: payload.secret,
  });
  return res;
}

export async function addVaultItemToProfiles(
  profiles: string[],
  payload: VaultAddPayload
): Promise<{ savedProfiles: string[]; failedProfiles: string[] }> {
  const unique = Array.from(new Set(profiles.filter(Boolean)));
  const savedProfiles: string[] = [];
  const failedProfiles: string[] = [];

  for (const profile of unique) {
    try {
      await addVaultItem(profile, payload);
      savedProfiles.push(profile);
    } catch {
      failedProfiles.push(profile);
    }
  }
  return { savedProfiles, failedProfiles };
}

export async function removeVaultItem(profile: string, id: string): Promise<boolean> {
  const res = await hermesWs.call<{ removed?: boolean }>("vault.remove", {
    ...(profile && profile !== "default" ? { profile } : {}),
    id,
  });
  return Boolean(res?.removed);
}
