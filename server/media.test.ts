import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSafeMediaFile } from "./media.js";

const tempDirs: string[] = [];

function makeTempHermesHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-media-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveSafeMediaFile", () => {
  it("allows generated images and media inside HERMES_HOME profile cache", () => {
    const hermesHome = makeTempHermesHome();
    const scratchDir = path.join(hermesHome, "profiles", "anna-coding", "cache", "scratch");
    fs.mkdirSync(scratchDir, { recursive: true });
    const imgPath = path.join(scratchDir, "anime-charakter.png");
    fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const res = resolveSafeMediaFile(imgPath, { hermesHome });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mime).toBe("image/png");
      expect(res.filename).toBe("anime-charakter.png");
      expect(res.forceAttachment).toBe(false);
    }
  });

  it("blocks secrets, config files, databases, and path traversal outside allowed roots", () => {
    const hermesHome = makeTempHermesHome();
    const profDir = path.join(hermesHome, "profiles", "anna-coding");
    const logsDir = path.join(profDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    const envFile = path.join(profDir, ".env");
    const cfgFile = path.join(profDir, "config.yaml");
    const logFile = path.join(logsDir, "debug.txt");
    fs.writeFileSync(envFile, "SECRET=1\n");
    fs.writeFileSync(cfgFile, "model: gpt-5\n");
    fs.writeFileSync(logFile, "sensitive log\n");

    expect(resolveSafeMediaFile(envFile, { hermesHome }).ok).toBe(false);
    expect(resolveSafeMediaFile(cfgFile, { hermesHome }).ok).toBe(false);
    expect(resolveSafeMediaFile(logFile, { hermesHome }).ok).toBe(false);
    expect(resolveSafeMediaFile("relative/file.png", { hermesHome }).ok).toBe(false);
  });

  it("forces attachment disposition on HTML/SVG files so scripts never execute on origin", () => {
    const hermesHome = makeTempHermesHome();
    const outDir = path.join(hermesHome, "profiles", "anna-coding", "workspace");
    fs.mkdirSync(outDir, { recursive: true });
    const htmlFile = path.join(outDir, "preview.html");
    fs.writeFileSync(htmlFile, "<script>alert(1)</script>");

    const res = resolveSafeMediaFile(htmlFile, { hermesHome });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.forceAttachment).toBe(true);
    }
  });
});
