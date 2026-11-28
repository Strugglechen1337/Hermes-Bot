import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTONOMOUS_GUIDANCE_HEADING } from "../shared/botAutonomy.js";
import { syncGuidanceToAllProfiles } from "./guidanceSync.js";

describe("syncGuidanceToAllProfiles", () => {
  it("updates old SOUL.md files once and keeps a backup", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "hp-sync-"));
    const dir = path.join(home, "profiles", "alex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SOUL.md"), "# Alex\n\nHallo.");
    expect(syncGuidanceToAllProfiles(home)).toEqual(["alex"]);
    const soul = fs.readFileSync(path.join(dir, "SOUL.md"), "utf8");
    expect(soul).toContain("# Alex");
    expect(soul).toContain(AUTONOMOUS_GUIDANCE_HEADING);
    expect(fs.readFileSync(path.join(dir, "SOUL.md.pocket-bak"), "utf8")).toBe("# Alex\n\nHallo.");
    expect(syncGuidanceToAllProfiles(home)).toEqual([]);
  });
  it("tolerates a missing profiles folder", () => {
    expect(syncGuidanceToAllProfiles(path.join(os.tmpdir(), "hp-none-xyz"))).toEqual([]);
  });
});
