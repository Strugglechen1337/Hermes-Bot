import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendAutonomousGuidance } from "../shared/botAutonomy.js";

/**
 * Brings the shared bot guidance in every existing profile's SOUL.md up to date (idempotent:
 * only the guidance section is replaced). Runs at startup so a release that changes the
 * guidance reaches old bots too. Returns the profiles that were changed.
 */
export function syncGuidanceToAllProfiles(hermesHome?: string): string[] {
  const home = hermesHome || process.env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes");
  const profilesDir = path.join(home, "profiles");
  const changed: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(profilesDir);
  } catch {
    return changed;
  }
  for (const name of names) {
    const soulPath = path.join(profilesDir, name, "SOUL.md");
    try {
      if (!fs.existsSync(soulPath)) continue;
      const current = fs.readFileSync(soulPath, "utf8");
      const next = appendAutonomousGuidance(current);
      if (next !== current.trim()) {
        fs.writeFileSync(`${soulPath}.pocket-bak`, current, "utf8");
        fs.writeFileSync(soulPath, `${next}\n`, "utf8");
        changed.push(name);
      }
    } catch {
      // skip unreadable profile
    }
  }
  return changed;
}
