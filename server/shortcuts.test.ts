import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getOrCreateShortcutToken,
  rotateShortcutToken,
  verifyShortcutBearer,
} from "./shortcuts.js";

const origDataDir = process.env.PUSH_DATA_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PUSH_DATA_DIR;
  else process.env.PUSH_DATA_DIR = origDataDir;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("iOS Shortcuts token auth", () => {
  it("generates, verifies, and rotates Bearer tokens safely", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-shortcut-test-"));
    tempDirs.push(dir);
    process.env.PUSH_DATA_DIR = dir;

    const token1 = getOrCreateShortcutToken();
    expect(token1.length).toBe(64);
    expect(verifyShortcutBearer(`Bearer ${token1}`)).toBe(true);
    expect(verifyShortcutBearer("Bearer wrong")).toBe(false);
    expect(verifyShortcutBearer(undefined)).toBe(false);

    const token2 = rotateShortcutToken();
    expect(token2).not.toBe(token1);
    expect(verifyShortcutBearer(`Bearer ${token1}`)).toBe(false);
    expect(verifyShortcutBearer(`Bearer ${token2}`)).toBe(true);
  });
});
