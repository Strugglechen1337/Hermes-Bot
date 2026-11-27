import { describe, expect, it } from "vitest";
import { compareSemver } from "./updater.js";

describe("compareSemver", () => {
  it("compares semantic versions with or without leading v", () => {
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("v2.1.0", "2.0.9")).toBe(1);
    expect(compareSemver("2.0.0", "v2.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
  });
});
