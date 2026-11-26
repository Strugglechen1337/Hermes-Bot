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

  it("parses Hermes account_usage lines with both remaining and used percentages correctly", () => {
    const windows = parseAccountUsageLines([
      "5-hour limit: 29% remaining (71% used) • resets in 2h 0m (2026-11-26 18:40 CET)",
      "Weekly limit: 89% remaining (11% used) • resets in 5d 19h (2026-12-02 12:39 CET)",
      "5h window: 38% used (resets in 2h 14m)",
    ]);
    expect(windows).toHaveLength(3);
    expect(windows[0]).toMatchObject({
      label: "5-hour limit",
      remainingPercent: 29,
      usedPercent: 71,
      resetText: "2h 0m",
    });
    expect(windows[1]).toMatchObject({
      label: "Weekly limit",
      remainingPercent: 89,
      usedPercent: 11,
      resetText: "5d 19h",
    });
    expect(windows[2]).toMatchObject({
      label: "5h window",
      remainingPercent: 62,
      usedPercent: 38,
      resetText: "2h 14m",
    });
  });

  it("merges session.usage payloads and computes remaining percent & severity", () => {
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
    expect(summary.mode).toBe("remaining");
    expect(summary.usedPercent).toBe(74);
    expect(summary.remainingPercent).toBe(26);
    expect(summary.barPercent).toBe(26);
    expect(summary.severity).toBe("warn");
  });

  it("picks the tightest (lowest remaining) quota window from session.account_usage", () => {
    const state = mergeAccountUsage(EMPTY_CHAT_USAGE, {
      lines: [
        "5-hour limit: 29% remaining (71% used)",
        "Weekly limit: 89% remaining (11% used)",
      ],
    });
    const summary = getPrimaryLimitSummary(state);
    expect(summary.label).toBe("5-hour limit");
    expect(summary.remainingPercent).toBe(29);
    expect(summary.usedPercent).toBe(71);
    expect(summary.severity).toBe("warn");
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
