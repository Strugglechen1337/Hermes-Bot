import { describe, expect, it } from "vitest";
import {
  AUTONOMOUS_BOT_GUIDANCE,
  AUTONOMOUS_GUIDANCE_HEADING,
  appendAutonomousGuidance,
} from "./botAutonomy.js";

describe("botAutonomy", () => {
  it("appends autonomous guidance while preserving existing SOUL content", () => {
    const base = "# Test Bot\n\nDu hilfst bei Technikfragen.";
    const result = appendAutonomousGuidance(base);
    expect(result.startsWith(base)).toBe(true);
    expect(result).toContain(AUTONOMOUS_GUIDANCE_HEADING);
    expect(result).toContain("[SECRET_REQUEST:");
    expect(result).toContain("E-Mails");
  });

  it("is idempotent and upgrades an older autonomous section in-place", () => {
    const once = appendAutonomousGuidance("# Clara\n\nHallo.");
    const twice = appendAutonomousGuidance(once);
    expect(twice).toBe(once);
    expect(twice.split(AUTONOMOUS_GUIDANCE_HEADING).length).toBe(2);

    const legacy = `# Lea\n\nNachrichten-Bot.\n\n${AUTONOMOUS_GUIDANCE_HEADING}\n- Alter Text ohne pocket-page.\n\n## Eigene Notizen\nBleibt erhalten.`;
    const upgraded = appendAutonomousGuidance(legacy);
    expect(upgraded).toContain("Nachrichten-Bot.");
    expect(upgraded).toContain("publish-page");
    expect(upgraded).toContain("[POCKET_PAGE:");
    expect(upgraded).toContain("## Eigene Notizen\nBleibt erhalten.");
    expect(upgraded).not.toContain("Alter Text ohne pocket-page.");
  });

  it("returns the standalone guidance block when input is empty", () => {
    expect(appendAutonomousGuidance("   ")).toBe(AUTONOMOUS_BOT_GUIDANCE);
  });
});
