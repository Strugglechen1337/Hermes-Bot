import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerUiPreferences, saveServerUiPreferences } from "./preferences.js";

const origDataDir = process.env.PUSH_DATA_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (origDataDir === undefined) {
    delete process.env.PUSH_DATA_DIR;
  } else {
    process.env.PUSH_DATA_DIR = origDataDir;
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("server UI preferences", () => {
  it("persists hiddenProfiles and hashed vaultPinHash cleanly while filtering invalid entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-prefs-test-"));
    tempDirs.push(dir);
    process.env.PUSH_DATA_DIR = dir;

    expect(loadServerUiPreferences()).toMatchObject({
      hiddenProfiles: [],
      vaultPinHash: null,
    });

    const validHash = "a".repeat(64);
    const saved = saveServerUiPreferences({
      hiddenProfiles: ["default", "mika", "bad name!", "mika"],
      vaultPinHash: validHash,
    });
    expect(saved.hiddenProfiles).toEqual(["mika"]);
    expect(saved.vaultPinHash).toBe(validHash);

    const reloaded = loadServerUiPreferences();
    expect(reloaded.hiddenProfiles).toEqual(["mika"]);
    expect(reloaded.vaultPinHash).toBe(validHash);

    const cleared = saveServerUiPreferences({ vaultPinHash: null });
    expect(cleared.vaultPinHash).toBeNull();
    expect(cleared.hiddenProfiles).toEqual(["mika"]);
  });
});
