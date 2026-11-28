import { describe, expect, it } from "vitest";
import { formatSteps, RECORDER_SCRIPT } from "./browserRecorder.js";

describe("formatSteps", () => {
  it("never prints secret values and drops duplicates", () => {
    const text = formatSteps([
      { t: 1, kind: "open", url: "https://shop.example/login" },
      { t: 2, kind: "type", target: "input [type=password]", secret: true },
      { t: 3, kind: "type", target: "input [name=q]", value: "milch" },
      { t: 4, kind: "click", target: 'button "Suchen"' },
      { t: 4, kind: "click", target: 'button "Suchen"' },
      { t: 5, kind: "key", value: "Enter", target: "input", secret: true },
    ]);
    expect(text.split("\n")).toHaveLength(4);
    expect(text).toContain("NICHT aufgezeichnet");
    expect(text).toContain('"milch"');
  });
  it("recorder script is valid JavaScript", () => {
    expect(() => new Function(RECORDER_SCRIPT)).not.toThrow();
  });
});
