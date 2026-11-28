import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { insertTextIntoActivePage, parseBrowserCdpPort, resolveBrowserDesktop } from "./browserDesktop.js";

describe("insertTextIntoActivePage", () => {
  it("types into the page that is visible, not a background tab", async () => {
    const got: { page: string; method: string; text?: string }[] = [];
    const wss = new WebSocketServer({ noServer: true });
    const srv = http.createServer((_req, res) => {
      const port = (srv.address() as AddressInfo).port;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify([
          { type: "page", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/bg` },
          { type: "page", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/front` },
        ])
      );
    });
    srv.on("upgrade", (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => {
        const page = String(req.url).slice(1);
        ws.on("message", (raw) => {
          const m = JSON.parse(String(raw));
          got.push({ page, method: m.method, text: m.params?.text });
          const value = page === "front" ? "visible" : "hidden";
          ws.send(JSON.stringify({ id: m.id, result: { result: { value } } }));
        });
      })
    );
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    await insertTextIntoActivePage((srv.address() as AddressInfo).port, "hallo");
    wss.close();
    await new Promise<void>((r) => srv.close(() => r()));
    const inserts = got.filter((g) => g.method === "Input.insertText");
    expect(inserts).toEqual([{ page: "front", method: "Input.insertText", text: "hallo" }]);
  });
});

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
    expect(resolveBrowserDesktop("mia", { hermesHome: h })).toMatchObject({ available: true, id: "9223", path: "/desk/9223/" });
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
