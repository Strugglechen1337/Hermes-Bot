import type { HermesModelOptionProvider } from "../../shared/types";

export type BotModelTier = "pro" | "balanced" | "fast";

export interface BotTierClassification {
  tier: BotModelTier;
  tierLabel: string;
  reason: string;
}

export interface SmartModelRecommendation extends BotTierClassification {
  provider: string;
  model: string;
}

export interface BotRoutingProfileInput {
  name: string;
  display_name?: string;
  bot_title?: string;
  description?: string;
  soul?: string;
}

const PRO_RE =
  /\b(cod(?:e|ing)|dev(?:elop)?|program|architekt|software|debug|github|it|admin|server|powershell|citrix|m365|entra|chief|chef|koordinator|recherche|research|analy[sz]|strategie|security|sicherheit)\b/i;

const FAST_RE =
  /\b(kalender|calendar|termin|mail|e-?mail|gmail|inbox|posteingang|paket|dhl|erinnerung|reminder|routine|cron|smart\s*home|home\s*assistant|hass|wetter|müll|abfall|notiz|todo|checkliste)\b/i;

const BALANCED_RE =
  /\b(einkauf|shop|deal|angebot|preis|news|nachrichten|briefing|reise|urlaub|koch|rezept|fitness|alltag|text|schreib)\b/i;

/**
 * Classifies a bot profile into a GPT model tier based on its role/name/description
 * so heavy coding/IT/research bots use the flagship GPT model while frequent
 * calendar/mail/routine bots use a faster, more quota-efficient GPT model.
 */
export function classifyBotModelTier(profile: BotRoutingProfileInput): BotTierClassification {
  const name = (profile.name || "").trim().toLowerCase();
  const combined = [
    profile.name,
    profile.bot_title,
    profile.display_name,
    profile.description,
    profile.soul,
  ]
    .filter(Boolean)
    .join(" ");

  if (name === "default" || name === "hermes" || PRO_RE.test(combined)) {
    return {
      tier: "pro",
      tierLabel: "Pro · Komplex",
      reason: "Starkes Flaggschiff-Modell für Coding, IT, Recherche & Koordination.",
    };
  }

  if (FAST_RE.test(combined)) {
    return {
      tier: "fast",
      tierLabel: "Schnell · Sparsam",
      reason: "Schnelles, kontingentschonendes Modell für Mails, Kalender & Routinen.",
    };
  }

  if (BALANCED_RE.test(combined)) {
    return {
      tier: "balanced",
      tierLabel: "Ausgewogen · Alltag",
      reason: "Gutes Verhältnis aus Tempo, Qualität & Quota für News, Einkauf & Alltag.",
    };
  }

  return {
    tier: "balanced",
    tierLabel: "Ausgewogen · Alltag",
    reason: "Universelles Standard-Modell mit gutem Verhältnis aus Qualität & Tempo.",
  };
}

function uniqueModels(provider: HermesModelOptionProvider): string[] {
  const merged = [
    ...(Array.isArray(provider.featured_models) ? provider.featured_models : []),
    ...(Array.isArray(provider.models) ? provider.models : []),
  ]
    .map((m) => String(m || "").trim())
    .filter(Boolean);
  return Array.from(new Set(merged));
}

function isNanoModel(m: string): boolean {
  return /\b(?:nano|flash-lite|lite)\b/i.test(m);
}

function isMiniModel(m: string): boolean {
  return /\b(?:mini|spark|fast|haiku)\b/i.test(m) && !isNanoModel(m);
}

function isCodexOrFlagshipGpt(m: string): boolean {
  const lower = m.toLowerCase();
  return lower.includes("gpt") && !isMiniModel(lower) && !isNanoModel(lower);
}

/**
 * Picks the best matching live GPT model from Hermes's configured `openai-codex`
 * (or `openai`) provider for the given bot profile.
 */
export function recommendGptModelForBot(
  profile: BotRoutingProfileInput,
  providers: HermesModelOptionProvider[]
): SmartModelRecommendation | null {
  const gptProvider =
    providers.find((p) => p.slug === "openai-codex" && p.is_current) ||
    providers.find((p) => p.slug === "openai-codex") ||
    providers.find((p) => p.slug === "openai" && p.is_current) ||
    providers.find((p) => p.slug === "openai");

  if (!gptProvider) return null;

  const models = uniqueModels(gptProvider);
  const gptModels = models.filter((m) => m.toLowerCase().includes("gpt"));
  const pool = gptModels.length > 0 ? gptModels : models;
  if (pool.length === 0) return null;

  const classification = classifyBotModelTier(profile);
  const flagship = pool.find(isCodexOrFlagshipGpt) || pool[0];
  const mini = pool.find(isMiniModel);
  const nano = pool.find(isNanoModel);

  let chosen = flagship;
  if (classification.tier === "fast") {
    chosen = nano || mini || flagship;
  } else if (classification.tier === "balanced") {
    chosen = mini || flagship;
  } else {
    chosen = flagship;
  }

  return {
    provider: gptProvider.slug,
    model: chosen,
    ...classification,
  };
}

export function buildAutoAssignPlan(
  profiles: BotRoutingProfileInput[],
  providers: HermesModelOptionProvider[]
): Array<{ profileName: string; recommendation: SmartModelRecommendation }> {
  const plan: Array<{ profileName: string; recommendation: SmartModelRecommendation }> = [];
  for (const prof of profiles) {
    const rec = recommendGptModelForBot(prof, providers);
    if (rec) {
      plan.push({ profileName: prof.name, recommendation: rec });
    }
  }
  return plan;
}
