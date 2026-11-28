import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.js";
import { handleDeskHttp, handleDeskUpgrade, isDeskUpgrade, parseDeskPath } from "./deskProxy.js";

describe("parseDeskPath", () => {
  it("accepts known desks and rejects the rest", () => {
    expect(parseDeskPath("/desk/9223/")?.id).toBe("9223");
    expect(parseDeskPath("/desk/9224/vnc.html?x=1")?.id).toBe("9224");
    expect(parseDeskPath("/desk/1234/")).toBeNull();
    expect(parseDeskPath("/deskx/9223/")).toBeNull();
    expect(parseDeskPath("/api/x")).toBeNull();
  });
});

describe("desk proxy", () => {
  let hermes: http.Server;
  let desk: http.Server;
  let deskWss: WebSocketServer;
  let bff: http.Server;
  let bffPort = 0;
  let envFile = "";
  let seenAuth: string[] = [];
  let seenCookie: (string | undefined)[] = [];

  beforeEach(async () => {
    seenAuth = [];
    seenCookie = [];
    hermes = http.createServer((req, res) => {
      const ok = String(req.headers.cookie || "").includes("sid=good");
      res.statusCode = ok ? 200 : 401;
      res.end("{}");
    });
    await new Promise<void>((r) => hermes.listen(0, "127.0.0.1", r));

    desk = http.createServer((req, res) => {
      seenAuth.push(String(req.headers.authorization));
      seenCookie.push(req.headers.cookie);
      res.setHeader("x-frame-options", "DENY");
      res.setHeader("content-type", "text/plain");
      res.end(`desk:${req.url}`);
    });
    deskWss = new WebSocketServer({ noServer: true });
    desk.on("upgrade", (req, socket, head) => {
      seenAuth.push(String(req.headers.authorization));
      deskWss.handleUpgrade(req, socket, head, (ws) => ws.on("message", (d) => ws.send(`echo:${d}`)));
    });
    await new Promise<void>((r) => desk.listen(0, "127.0.0.1", r));

    envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hp-desk-")), ".env");
    fs.writeFileSync(envFile, "CUSTOM_USER=bots\nPASSWORD=secret-pass\n");
    process.env.HERMES_POCKET_BROWSER_ENV = envFile;
    process.env.HERMES_POCKET_BROWSER_DESKTOPS = JSON.stringify({
      "9223": { upstreamPort: (desk.address() as AddressInfo).port, label: "Test" },
    });

    const config = {
      hermesBaseUrl: `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`,
      host: "127.0.0.1",
      port: 0,
      cookieSecure: "false",
      staticDir: ".",
    } as ServerConfig;
    bff = http.createServer((req, res) => {
      void handleDeskHttp(req, res, config).then((h) => {
        if (!h) {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    bff.on("upgrade", (req, socket, head) => {
      if (isDeskUpgrade(req)) void handleDeskUpgrade(req, socket, head, config);
      else socket.destroy();
    });
    await new Promise<void>((r) => bff.listen(0, "127.0.0.1", r));
    bffPort = (bff.address() as AddressInfo).port;
  });

  afterEach(async () => {
    delete process.env.HERMES_POCKET_BROWSER_ENV;
    delete process.env.HERMES_POCKET_BROWSER_DESKTOPS;
    deskWss.close();
    await Promise.all([hermes, desk, bff].map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  function get(pathname: string, cookie?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: bffPort, path: pathname, headers: cookie ? { cookie } : {} }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
        })
        .on("error", reject);
    });
  }

  it("refuses visitors without a Hermes session and never calls the desktop", async () => {
    expect((await get("/desk/9223/")).status).toBe(401);
    expect((await get("/desk/9223/", "sid=bad")).status).toBe(401);
    expect(seenAuth).toHaveLength(0);
  });

  it("proxies for a signed-in user, adds the desktop login and strips the user's cookie", async () => {
    const r = await get("/desk/9223/vnc.html", "sid=good");
    expect(r.status).toBe(200);
    expect(r.body).toBe("desk:/vnc.html");
    expect(r.headers["x-frame-options"]).toBeUndefined();
    expect(seenAuth[0]).toBe(`Basic ${Buffer.from("bots:secret-pass").toString("base64")}`);
    expect(seenCookie[0]).toBeUndefined();
  });

  it("answers 404 for unknown desktops", async () => {
    expect((await get("/desk/9999/", "sid=good")).status).toBe(404);
  });

  it("tunnels WebSockets for a signed-in user only", async () => {
    const open = (cookie: string) =>
      new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${bffPort}/desk/9223/websockify`, { headers: { cookie } });
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
        ws.on("unexpected-response", (_q, res) => reject(new Error(`status ${res.statusCode}`)));
      });
    await expect(open("sid=bad")).rejects.toThrow();
    const ws = await open("sid=good");
    const reply = await new Promise<string>((resolve) => {
      ws.on("message", (d) => resolve(d.toString()));
      ws.send("ping");
    });
    expect(reply).toBe("echo:ping");
    ws.close();
  });
});
