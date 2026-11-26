import type {
  HermesAccountUsageResponse,
  HermesFallbackProvider,
  HermesPlanGauge,
} from "../../shared/types";

export interface ParsedQuotaWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetText: string | null;
  rawLine?: string;
}

export interface ChatUsageState {
  contextTokens: number | null;
  contextMax: number | null;
  contextPercent: number | null;
  totalTokens: number | null;
  model: string | null;
  provider: string | null;
  fallbackModel: string | null;
  planGauge: HermesPlanGauge | null;
  accountLines: string[];
  quotaWindows: ParsedQuotaWindow[];
  updatedAt: number | null;
}

export const EMPTY_CHAT_USAGE: ChatUsageState = {
  contextTokens: null,
  contextMax: null,
  contextPercent: null,
  totalTokens: null,
  model: null,
  provider: null,
  fallbackModel: null,
  planGauge: null,
  accountLines: [],
  quotaWindows: [],
  updatedAt: null,
};

export const RECOMMENDED_ANTHROPIC_FALLBACK: HermesFallbackProvider = {
  provider: "anthropic",
  model: "claude-sonnet-5-5",
};

export function formatResetCountdown(resetsAtMs: number | null | undefined, nowMs = Date.now()): string | null {
  if (typeof resetsAtMs !== "number" || !Number.isFinite(resetsAtMs) || resetsAtMs <= 0) {
    return null;
  }
  // Support epoch seconds or milliseconds
  const targetMs = resetsAtMs < 1e12 ? resetsAtMs * 1000 : resetsAtMs;
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return "jetzt";

  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `in ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins > 0 ? `in ${hours} Std. ${remMins} Min.` : `in ${hours} Std.`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `in ${days} T. ${remHours} Std.` : `in ${days} T.`;
}

export function formatCompactTokens(tokens: number | null | undefined): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return "—";
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export function parsePlanGaugePercent(gauge: HermesPlanGauge | null | undefined): number | null {
  if (!gauge || typeof gauge.used_bp !== "number" || !Number.isFinite(gauge.used_bp)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(gauge.used_bp / 100)));
}

/**
 * Extracts structured quota windows from Hermes `session.account_usage` lines
 * (e.g. "5h window: 38% used (resets in 2h 14m)" or "Weekly: 72% left · resets Thu").
 */
export function parseAccountUsageLines(lines: string[]): ParsedQuotaWindow[] {
  const windows: ParsedQuotaWindow[] = [];
  for (const raw of lines) {
    const clean = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!clean) continue;

    const pctMatch = clean.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (!pctMatch) continue;

    const rawPct = Math.max(0, Math.min(100, Math.round(Number(pctMatch[1]))));
    const lower = clean.toLowerCase();
    const isRemaining =
      /\b(left|remaining|übrig|verfügbar|frei)\b/.test(lower) &&
      !/\b(used|verbraucht|genutzt)\b/.test(lower);
    const usedPercent = isRemaining ? 100 - rawPct : rawPct;
    const remainingPercent = 100 - usedPercent;

    // Label before colon or before percentage
    let label = "Limit";
    const colonIdx = clean.indexOf(":");
    if (colonIdx > 0 && colonIdx < 40) {
      label = clean.slice(0, colonIdx).replace(/^[-•*]\s*/, "").trim();
    } else if (pctMatch.index && pctMatch.index > 0) {
      label = clean.slice(0, pctMatch.index).replace(/^[-•*]\s*/, "").trim().slice(0, 32) || "Limit";
    }

    let resetText: string | null = null;
    const resetMatch = clean.match(/(?:resets?\s*(?:in|at|on)?|zurückgesetzt\s*(?:in|am|um)?)\s*([^)|]+?)(?:\)|$)/i);
    if (resetMatch?.[1]) {
      resetText = resetMatch[1].trim();
    }

    windows.push({
      label,
      usedPercent,
      remainingPercent,
      resetText,
      rawLine: clean,
    });
  }
  return windows;
}

export function mergeUsagePayload(
  prev: ChatUsageState,
  payload: Record<string, unknown> | null | undefined
): ChatUsageState {
  if (!payload || typeof payload !== "object") return prev;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const contextTokens =
    num(payload.context_tokens) ??
    num(payload.context_used) ??
    num(payload.last_prompt_tokens) ??
    prev.contextTokens;

  const contextMax =
    num(payload.context_length) ??
    num(payload.context_max) ??
    num(payload.config_context_length) ??
    prev.contextMax;

  let contextPercent = num(payload.context_percent);
  if (contextPercent !== null) {
    contextPercent = Math.max(0, Math.min(100, Math.round(contextPercent)));
  } else if (contextTokens !== null && contextMax !== null && contextMax > 0) {
    contextPercent = Math.max(0, Math.min(100, Math.round((contextTokens / contextMax) * 100)));
  } else {
    contextPercent = prev.contextPercent;
  }

  let planGauge = prev.planGauge;
  if (payload.plan_gauge && typeof payload.plan_gauge === "object") {
    const g = payload.plan_gauge as Record<string, unknown>;
    if (typeof g.used_bp === "number") {
      planGauge = {
        id: str(g.id) ?? undefined,
        label: str(g.label) ?? undefined,
        used_bp: g.used_bp,
        resets_at_ms: num(g.resets_at_ms),
      };
    }
  }

  return {
    ...prev,
    contextTokens,
    contextMax,
    contextPercent,
    totalTokens: num(payload.total_tokens) ?? prev.totalTokens,
    model: str(payload.model) ?? prev.model,
    provider: str(payload.provider) ?? prev.provider,
    fallbackModel: str(payload.fallback_model) ?? prev.fallbackModel,
    planGauge,
    updatedAt: Date.now(),
  };
}

export function mergeAccountUsage(
  prev: ChatUsageState,
  res: HermesAccountUsageResponse | null | undefined
): ChatUsageState {
  if (!res || typeof res !== "object") return prev;
  const rawLines = [
    ...(Array.isArray(res.lines) ? res.lines : []),
    ...(Array.isArray(res.nous_lines) ? res.nous_lines : []),
  ].filter((l): l is string => typeof l === "string" && l.trim().length > 0);

  if (rawLines.length === 0) return prev;
  return {
    ...prev,
    accountLines: rawLines,
    quotaWindows: parseAccountUsageLines(rawLines),
    updatedAt: Date.now(),
  };
}

export function getPrimaryLimitSummary(usage: ChatUsageState): {
  label: string;
  usedPercent: number | null;
  resetText: string | null;
  severity: "normal" | "warn" | "critical";
} {
  const gaugePct = parsePlanGaugePercent(usage.planGauge);
  if (gaugePct !== null) {
    return {
      label: usage.planGauge?.label || "Plan-Limit",
      usedPercent: gaugePct,
      resetText: formatResetCountdown(usage.planGauge?.resets_at_ms),
      severity: gaugePct >= 90 ? "critical" : gaugePct >= 70 ? "warn" : "normal",
    };
  }

  if (usage.quotaWindows.length > 0) {
    // Pick the tightest (highest usedPercent) window so the user never misses a near-limit cap
    const tightest = usage.quotaWindows.reduce((acc, w) =>
      w.usedPercent > acc.usedPercent ? w : acc
    );
    return {
      label: tightest.label,
      usedPercent: tightest.usedPercent,
      resetText: tightest.resetText,
      severity:
        tightest.usedPercent >= 90
          ? "critical"
          : tightest.usedPercent >= 70
            ? "warn"
            : "normal",
    };
  }

  if (usage.contextPercent !== null) {
    return {
      label: "Chat-Kontext",
      usedPercent: usage.contextPercent,
      resetText: null,
      severity:
        usage.contextPercent >= 90
          ? "critical"
          : usage.contextPercent >= 75
            ? "warn"
            : "normal",
    };
  }

  return {
    label: "Limit",
    usedPercent: null,
    resetText: null,
    severity: "normal",
  };
}
