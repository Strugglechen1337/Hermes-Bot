// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHermesPocketServer } from "./index.js";
import { setBotPrivateInPushStore } from "./push.js";

describe("Hermes Pocket Push Preferences & Private Bot Isolation", () => {
  let upstream: http.Server;
  let bff: http.Server;
  let bffUrl: string;
  let tempDir: string;
  let tempHermesHome: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-push-prefs-"));
    tempHermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "hp-hermes-home-"));
    process.env.PUSH_DATA_DIR = tempDir;
    process.env.HERMES_HOME = tempHermesHome;

    // Create a private profile on disk with bot_mode_protocol: false
    const privDir = path.join(tempHermesHome, "profiles", "secret-bot");
    fs.mkdirSync(privDir, { recursive: true });
    fs.writeFileSync(path.join(privDir, "config.yaml"), "agent:\n  bot_mode_protocol: false\n", "utf8");

    upstream = http.createServer((req, res) => {
      if (req.url === "/api/auth/me") {
        if (req.headers.cookie?.includes("hermes_access=valid")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ user_id: "u1", display_name: "Tester" }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    bff = createHermesPocketServer({
      hermesBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      host: "127.0.0.1",
      port: 0,
      cookieSecure: "auto",
      staticDir: "__nonexistent__",
    });
    await new Promise<void>((resolve) => bff.listen(0, "127.0.0.1", resolve));
    const bffPort = (bff.address() as AddressInfo).port;
    bffUrl = `http://127.0.0.1:${bffPort}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => bff.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempHermesHome, { recursive: true, force: true });
    delete process.env.PUSH_DATA_DIR;
    delete process.env.HERMES_HOME;
  });

  it("defaults to globalEnabled=true so all existing and newly created public bots can push", async () => {
    const res = await fetch(`${bffUrl}/api/pocket/push/status`, {
      headers: { Cookie: "hermes_access=valid" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      preferences: { globalEnabled: boolean; disabledBots: string[] };
    };
    expect(data.preferences).toEqual({ globalEnabled: true, disabledBots: [] });
  });

  it("blocks private bots (both config.yaml and store-marked), per-bot opt-out, and master switch OFF", async () => {
    // Initialize store & read bot push token
    await fetch(`${bffUrl}/api/pocket/push/status`, {
      headers: { Cookie: "hermes_access=valid" },
    });
    const token = fs.readFileSync(path.join(tempDir, "bot-push-token"), "utf8").trim();

    // 1. Private bot via config.yaml is blocked even when globalEnabled=true
    const privRes = await fetch(`${bffUrl}/api/pocket/push/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pocket-Push-Token": token },
      body: JSON.stringify({ bot: "secret-bot", title: "Secret", body: "Test" }),
    });
    expect(((await privRes.json()) as { blocked?: string }).blocked).toBe("private_bot");

    // 2. Private bot via store marker is also blocked
    setBotPrivateInPushStore("vault-bot", true);
    const privRes2 = await fetch(`${bffUrl}/api/pocket/push/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pocket-Push-Token": token },
      body: JSON.stringify({ bot: "vault-bot", title: "Vault", body: "Test" }),
    });
    expect(((await privRes2.json()) as { blocked?: string }).blocked).toBe("private_bot");

    // 3. Per-bot toggle OFF blocks only that bot, leaving brand-new public bots allowed
    const prefRes = await fetch(`${bffUrl}/api/pocket/push/preferences`, {
      method: "PUT",
      headers: {
        Cookie: "hermes_access=valid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bot: "lea-news", enabled: false }),
    });
    expect(prefRes.status).toBe(200);

    const leaBlocked = await fetch(`${bffUrl}/api/pocket/push/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pocket-Push-Token": token },
      body: JSON.stringify({ bot: "lea-news", title: "Lea", body: "News" }),
    });
    expect(((await leaBlocked.json()) as { blocked?: string }).blocked).toBe("bot_disabled");

    const newBotAllowed = await fetch(`${bffUrl}/api/pocket/push/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pocket-Push-Token": token },
      body: JSON.stringify({ bot: "brand-new-bot", title: "Neu", body: "Hallo" }),
    });
    expect(((await newBotAllowed.json()) as { blocked?: string }).blocked).toBeUndefined();

    // 4. Master switch OFF blocks every bot
    await fetch(`${bffUrl}/api/pocket/push/preferences`, {
      method: "PUT",
      headers: {
        Cookie: "hermes_access=valid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ globalEnabled: false }),
    });

    const masterBlocked = await fetch(`${bffUrl}/api/pocket/push/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pocket-Push-Token": token },
      body: JSON.stringify({ bot: "brand-new-bot", title: "Neu", body: "Hallo" }),
    });
    expect(((await masterBlocked.json()) as { blocked?: string }).blocked).toBe("global_disabled");
  });
});
