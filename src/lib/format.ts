/**
 * Safe, dependency-free date/time formatting helpers for German UI copy.
 */

export function formatRelativeTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  let ms: number;
  if (typeof value === "number") {
    ms = value > 1e12 ? value : value * 1000;
  } else {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return String(value);
    ms = parsed;
  }

  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 45) return "gerade eben";
  if (diffSec < 3600) return `vor ${Math.floor(diffSec / 60)} Min.`;
  if (diffSec < 86400) return `vor ${Math.floor(diffSec / 3600)} Std.`;

  const date = new Date(ms);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatShortTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const ms =
    typeof value === "number"
      ? value > 1e12
        ? value
        : value * 1000
      : Date.parse(value);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function randomClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
