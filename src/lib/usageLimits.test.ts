import { describe, expect, it } from "vitest";
import {
  EMPTY_CHAT_USAGE,
  formatCompactTokens,
  formatResetCountdown,
  getPrimaryLimitSummary,
  mergeAccountUsage,
  mergeUsagePayload,
  parseAccountUsageLines,
  parsePlanGaugePercent,
} from "./usageLimits";

describe("usageLimits", () => {
  it("converts plan_gauge basis points to percentage cleanly", () => {
    expect(parsePlanGaugePercent({ used_bp: 4250 })).toBe(43);
    expect(parsePlanGaugePercent({ used_bp: 0 })).toBe(0);
    expect(parsePlanGaugePercent({ used_bp: 12000 })).toBe(100);
    expect(parsePlanGaugePercent(null)).toBeNull();
  });

  it("parses account usage lines for both used and remaining phrasing", () => {
    const windows = parseAccountUsageLines([
      "5h window: 38% used (resets in 2h 14m)",
      "Weekly: 72% remaining (resets Thu)",
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      label: "5h window",
      usedPercent: 38,
      remainingPercent: 62,
      resetText: "2h 14m",
    });
    expect(windows[1]).toMatchObject({
      label: "Weekly",
      usedPercent: 28,
      remainingPercent: 72,
      resetText: "Thu",
    });
  });

  it("merges session.usage payloads and computes context percent", () => {
    const next = mergeUsagePayload(EMPTY_CHAT_USAGE, {
      context_tokens: 25_000,
      context_length: 100_000,
      model: "gpt-6.1-terra",
      provider: "openai-codex",
      plan_gauge: { label: "5h-Limit", used_bp: 7400, resets_at_ms: Date.now() + 90 * 60_000 },
    });
    expect(next.contextPercent).toBe(25);
    expect(next.model).toBe("gpt-6.1-terra");
    const summary = getPrimaryLimitSummary(next);
    expect(summary.label).toBe("5h-Limit");
    expect(summary.usedPercent).toBe(74);
    expect(summary.severity).toBe("warn");
  });

  it("picks the tightest quota window from session.account_usage", () => {
    const state = mergeAccountUsage(EMPTY_CHAT_USAGE, {
      lines: ["5h window: 40% used", "Weekly: 92% used"],
    });
    const summary = getPrimaryLimitSummary(state);
    expect(summary.label).toBe("Weekly");
    expect(summary.usedPercent).toBe(92);
    expect(summary.severity).toBe("critical");
  });

  it("formats compact tokens and reset countdowns", () => {
    expect(formatCompactTokens(950)).toBe("950");
    expect(formatCompactTokens(4200)).toBe("4.2k");
    expect(formatCompactTokens(128000)).toBe("128k");
    const now = 1_700_000_000_000;
    expect(formatResetCountdown(now + 45 * 60_000, now)).toBe("in 45 Min.");
    expect(formatResetCountdown(now + 135 * 60_000, now)).toBe("in 2 Std. 15 Min.");
  });
});
