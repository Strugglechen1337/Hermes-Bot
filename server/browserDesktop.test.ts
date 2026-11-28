import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBrowserCdpPort, resolveBrowserDesktop } from "./browserDesktop.js";

describe("parseBrowserCdpPort", () => {
  it("reads the port from the browser block", () => {
    expect(parseBrowserCdpPort("a: 1\nbrowser:\n  cdp_url: http://127.0.0.1:9224\n  x: 1\n")).toBe(9224);
  });
  it("ignores cdp_url outside the browser block", () => {
    expect(parseBrowserCdpPort("other:\n  cdp_url: http://127.0.0.1:9223\nbrowser:\n  x: 1\n")).toBeNull();
  });
  it("returns null without a cdp_url", () => {
    expect(parseBrowserCdpPort("browser:\n  cdp_url: ''\n")).toBeNull();
  });
});

describe("resolveBrowserDesktop", () => {
  function home(profile: string, yaml: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-bd-"));
    fs.mkdirSync(path.join(dir, "profiles", profile), { recursive: true });
    fs.writeFileSync(path.join(dir, "profiles", profile, "config.yaml"), yaml);
    return dir;
  }
  it("maps the CDP port to a desktop port", () => {
    const h = home("mia", "browser:\n  cdp_url: http://127.0.0.1:9223\n");
    expect(resolveBrowserDesktop("mia", { hermesHome: h })).toMatchObject({ available: true, port: 8445 });
  });
  it("is unavailable for private bots even when attached", () => {
    const h = home("emma", "browser:\n  cdp_url: http://127.0.0.1:9224\n");
    expect(resolveBrowserDesktop("emma", { hermesHome: h, isPrivate: true })).toEqual({ available: false });
  });
  it("is unavailable without a browser config or for unsafe names", () => {
    const h = home("nina", "x: 1\n");
    expect(resolveBrowserDesktop("nina", { hermesHome: h }).available).toBe(false);
    expect(resolveBrowserDesktop("../etc", { hermesHome: h }).available).toBe(false);
  });
});
