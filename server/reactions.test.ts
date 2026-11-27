import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSessionReactions, toggleReaction } from "./reactions.js";

const origDataDir = process.env.PUSH_DATA_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PUSH_DATA_DIR;
  else process.env.PUSH_DATA_DIR = origDataDir;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("server message reactions", () => {
  it("toggles and persists reactions per session and message key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-react-test-"));
    tempDirs.push(dir);
    process.env.PUSH_DATA_DIR = dir;

    expect(getSessionReactions("sess-1")).toEqual({});

    const r1 = toggleReaction("sess-1", "msg-42", "👍");
    expect(r1).toEqual({ "msg-42": ["👍"] });

    const r2 = toggleReaction("sess-1", "msg-42", "❤️");
    expect(r2).toEqual({ "msg-42": ["👍", "❤️"] });

    // Toggling 👍 again removes it
    const r3 = toggleReaction("sess-1", "msg-42", "👍");
    expect(r3).toEqual({ "msg-42": ["❤️"] });
  });
});
