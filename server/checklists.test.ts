import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getChecklist, upsertChecklist } from "./checklists.js";

const origDataDir = process.env.PUSH_DATA_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PUSH_DATA_DIR;
  else process.env.PUSH_DATA_DIR = origDataDir;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("server checklists", () => {
  it("stores, updates, and retrieves interactive checklist state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-chk-test-"));
    tempDirs.push(dir);
    process.env.PUSH_DATA_DIR = dir;

    expect(getChecklist("einkauf-1")).toBeNull();

    const saved = upsertChecklist("einkauf-1", "Einkaufsliste", [
      { text: "Milch", checked: false },
      { text: "Kaffee", checked: true },
    ]);
    expect(saved.items).toEqual([
      { text: "Milch", checked: false },
      { text: "Kaffee", checked: true },
    ]);

    const reloaded = getChecklist("einkauf-1");
    expect(reloaded?.title).toBe("Einkaufsliste");
    expect(reloaded?.items[1].checked).toBe(true);
  });
});
