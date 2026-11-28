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

function isUnsupportedOnCodexOAuth(m: string): boolean {
  // ChatGPT OAuth (openai-codex) rejects gpt-5.4-mini / gpt-5.4-nano with
  // "Model entitlement rejection" on standard plans, and spark is Pro-only.
  const lower = m.toLowerCase();
  return (
    lower.includes("5.4-mini") ||
    lower.includes("5.4-nano") ||
    lower.includes("-spark") ||
    lower.endsWith("-pro")
  );
}

function isCodexOrFlagshipGpt(m: string): boolean {
  const lower = m.toLowerCase();
  return lower.includes("gpt") && !isMiniModel(lower) && !isNanoModel(lower);
}

function pickFirstMatching(pool: string[], patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const found = pool.find((m) => re.test(m));
    if (found) return found;
  }
  return undefined;
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

  const isCodexOAuth = gptProvider.slug === "openai-codex";
  const rawModels = uniqueModels(gptProvider);
  const filteredModels = isCodexOAuth
    ? rawModels.filter((m) => !isUnsupportedOnCodexOAuth(m))
    : rawModels;
  const gptModels = filteredModels.filter((m) => m.toLowerCase().includes("gpt"));
  const pool = gptModels.length > 0 ? gptModels : filteredModels;
  if (pool.length === 0) return null;

  const classification = classifyBotModelTier(profile);
  let chosen: string;

  if (isCodexOAuth) {
    // Verified ChatGPT Codex OAuth model families:
    // - Pro: sol / astra (or terra fallback)
    // - Balanced: terra (or sol fallback)
    // - Fast/Efficient: luna (or terra fallback)
    const proModel =
      pickFirstMatching(pool, [
        /^gpt-6\.1-sol$/i,
        /^gpt-6\.2-sol$/i,
        /^gpt-6\.2-astra$/i,
        /^gpt-6-sol$/i,
        /^gpt-6\.1-terra$/i,
        /-sol$/i,
        /-astra$/i,
      ]) || pool.find(isCodexOrFlagshipGpt) || pool[0];

    const balancedModel =
      pickFirstMatching(pool, [
        /^gpt-6\.1-terra$/i,
        /^gpt-5\.6-terra$/i,
        /-terra$/i,
        /^gpt-6-sol$/i,
      ]) || proModel;

    const fastModel =
      pickFirstMatching(pool, [
        /^gpt-6-luna$/i,
        /^gpt-5\.6-luna$/i,
        /-luna$/i,
        /^gpt-6\.1-terra$/i,
      ]) || balancedModel;

    if (classification.tier === "fast") {
      chosen = fastModel;
    } else if (classification.tier === "balanced") {
      chosen = balancedModel;
    } else {
      chosen = proModel;
    }
  } else {
    const flagship = pool.find(isCodexOrFlagshipGpt) || pool[0];
    const mini = pool.find(isMiniModel);
    const nano = pool.find(isNanoModel);
    if (classification.tier === "fast") {
      chosen = nano || mini || flagship;
    } else if (classification.tier === "balanced") {
      chosen = mini || flagship;
    } else {
      chosen = flagship;
    }
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
