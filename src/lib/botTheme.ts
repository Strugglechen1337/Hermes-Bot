import type { HermesProfile } from "../../shared/types";

export interface BotVisualIdentity {
  initials: string;
  gradient: string;
  accent: string;
  label: string;
  subtitle: string;
}

const PALETTES = [
  { gradient: "linear-gradient(135deg, #f59e0b 0%, #fb7185 100%)", accent: "#f59e0b" },
  { gradient: "linear-gradient(135deg, #6366f1 0%, #38bdf8 100%)", accent: "#818cf8" },
  { gradient: "linear-gradient(135deg, #10b981 0%, #14b8a6 100%)", accent: "#34d399" },
  { gradient: "linear-gradient(135deg, #ec4899 0%, #a855f7 100%)", accent: "#f472b6" },
  { gradient: "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)", accent: "#60a5fa" },
  { gradient: "linear-gradient(135deg, #f97316 0%, #eab308 100%)", accent: "#fb923c" },
];

const KNOWN_PALETTE_INDEX: Record<string, number> = {
  mika: 0,
  default: 1,
  entwickler: 2,
  brainstormer: 3,
  recherche: 4,
  technik: 5,
  pruefer: 1,
};

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getBotLabel(profile: Pick<HermesProfile, "name" | "display_name" | "bot_title">): string {
  const custom = (profile.display_name || profile.bot_title || "").trim();
  if (custom) return custom;
  if (profile.name === "default") return "Hermes";
  return profile.name.charAt(0).toUpperCase() + profile.name.slice(1);
}

export function getBotVisual(profile: Pick<HermesProfile, "name" | "display_name" | "bot_title" | "description" | "model">): BotVisualIdentity {
  const key = profile.name.toLowerCase();
  const paletteIdx =
    key in KNOWN_PALETTE_INDEX
      ? KNOWN_PALETTE_INDEX[key]
      : hashName(key) % PALETTES.length;
  const palette = PALETTES[paletteIdx];
  const label = getBotLabel(profile);

  const words = label.split(/\s+/).filter(Boolean);
  const initials =
    words.length >= 2
      ? `${words[0][0]}${words[1][0]}`.toUpperCase()
      : label.slice(0, 2).toUpperCase();

  const subtitle =
    profile.description?.trim() ||
    (profile.model ? `Modell: ${profile.model}` : "Hermes-Profil");

  return {
    initials,
    gradient: palette.gradient,
    accent: palette.accent,
    label,
    subtitle,
  };
}

export function getProfileAvatarByName(name: string, profiles: HermesProfile[]): BotVisualIdentity {
  const found = profiles.find((p) => p.name === name);
  if (found) return getBotVisual(found);
  return getBotVisual({
    name,
    display_name: "",
    bot_title: "",
    description: "",
    model: null,
  });
}
