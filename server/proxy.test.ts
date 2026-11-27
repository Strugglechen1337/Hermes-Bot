// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHermesPocketServer } from "./index.js";

describe("Hermes Pocket BFF HTTP Proxy", () => {
  let upstream: http.Server;
  let bff: http.Server;
  let bffUrl: string;
  let tempPushDir: string;

  beforeAll(async () => {
    tempPushDir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-push-test-"));
    process.env.PUSH_DATA_DIR = tempPushDir;
    upstream = http.createServer((req, res) => {
      if (req.url === "/api/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: "0.23.4", gateway_running: true, auth_required: true, auth_providers: ["basic"] }));
        return;
      }
      if (req.url === "/auth/password-login" && req.method === "POST") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": "hermes_access=test_token; HttpOnly; Path=/; Secure",
        });
        res.end(JSON.stringify({ ok: true, next: "/" }));
        return;
      }
      if (req.url === "/auth/logout" && req.method === "POST") {
        res.writeHead(302, {
          Location: "/login",
          "Set-Cookie": "hermes_access=; Max-Age=0; HttpOnly; Path=/",
        });
        res.end();
        return;
      }
      if (req.url === "/api/auth/me" && req.method === "GET") {
        if (req.headers.cookie?.includes("hermes_access=valid")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ user_id: "u1", display_name: "Tester" }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
        }
        return;
      }
      if (req.url?.startsWith("/api/config") && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            fallback_providers: [{ provider: "anthropic", model: "claude-sonnet-5-5" }],
            unrelated_secret_field: "must-not-leak",
          })
        );
        return;
      }
      if (req.url?.startsWith("/api/config") && req.method === "PUT") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url?.startsWith("/api/env") && req.method === "PUT") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
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
    delete process.env.PUSH_DATA_DIR;
    fs.rmSync(tempPushDir, { recursive: true, force: true });
  });

  it("proxies /api/status cleanly", async () => {
    const res = await fetch(`${bffUrl}/api/status`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { version: string };
    expect(data.version).toBe("0.23.4");
  });

  it("forwards login cookies and adapts Secure flag for local HTTP", async () => {
    const res = await fetch(`${bffUrl}/auth/password-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "basic", username: "u", password: "p" }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("hermes_access=test_token");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("Secure");
  });

  it("translates Hermes 302 logout into 200 JSON while keeping Set-Cookie", async () => {
    const res = await fetch(`${bffUrl}/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("blocks disallowed upstream paths with 404", async () => {
    const res = await fetch(`${bffUrl}/api/env`);
    expect(res.status).toBe(404);
  });

  it("blocks cross-origin mutations with 403", async () => {
    const res = await fetch(`${bffUrl}/auth/logout`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(res.status).toBe(403);
  });

  it("exposes only fallback_providers via /api/pocket/fallback and strips unrelated config fields", async () => {
    const res = await fetch(`${bffUrl}/api/pocket/fallback?profile=mika`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.fallback_providers).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5-5" },
    ]);
    expect(data.unrelated_secret_field).toBeUndefined();

    const putRes = await fetch(`${bffUrl}/api/pocket/fallback?profile=mika`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fallback_providers: [{ provider: "anthropic", model: "claude-sonnet-5-5" }],
      }),
    });
    expect(putRes.status).toBe(200);
  });

  it("enforces write-only & strict key validation on /api/pocket/secret", async () => {
    const getRes = await fetch(`${bffUrl}/api/pocket/secret?profile=mika`);
    expect(getRes.status).toBe(405);

    const badKey = await fetch(`${bffUrl}/api/pocket/secret?profile=mika`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "bad key!", value: "secret" }),
    });
    expect(badKey.status).toBe(400);

    const okRes = await fetch(`${bffUrl}/api/pocket/secret?profile=mika`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "BRAVE_API_KEY", value: "demo-secret" }),
    });
    expect(okRes.status).toBe(200);
    const secretData = (await okRes.json()) as { envPathHint?: string };
    expect(secretData.envPathHint).toBe("~/.hermes/profiles/mika/.env");
  });

  it("protects /api/pocket/push/* with Hermes session auth", async () => {
    const unauth = await fetch(`${bffUrl}/api/pocket/push/status`);
    expect(unauth.status).toBe(401);

    const authed = await fetch(`${bffUrl}/api/pocket/push/status`, {
      headers: { Cookie: "hermes_access=valid" },
    });
    expect(authed.status).toBe(200);
    const statusData = (await authed.json()) as { ok: boolean; vapidPublicKey: string };
    expect(statusData.ok).toBe(true);
    expect(statusData.vapidPublicKey.length).toBeGreaterThan(20);
  });

  it("updates agent.bot_mode_protocol safely via /api/pocket/privacy and refuses default profile", async () => {
    const badDefault = await fetch(`${bffUrl}/api/pocket/privacy?profile=default`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ private: true }),
    });
    expect(badDefault.status).toBe(400);

    const okRes = await fetch(`${bffUrl}/api/pocket/privacy?profile=privat-bot`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ private: true }),
    });
    expect(okRes.status).toBe(200);
    const data = (await okRes.json()) as { ok: boolean; private: boolean };
    expect(data).toMatchObject({ ok: true, private: true });
  });

  it("enriches GET /api/profiles payloads with chief, pinned and private flags from profile.yaml", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { enrichProfilesPayloadWithPocketMeta } = await import("./proxy.js");

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-meta-test-"));
    try {
      const emmaDir = path.join(tmpHome, "profiles", "emma");
      const novaDir = path.join(tmpHome, "profiles", "nova-chief");
      const isolatedDir = path.join(tmpHome, "profiles", "secret-bot");
      fs.mkdirSync(emmaDir, { recursive: true });
      fs.mkdirSync(novaDir, { recursive: true });
      fs.mkdirSync(isolatedDir, { recursive: true });

      fs.writeFileSync(
        path.join(emmaDir, "profile.yaml"),
        [
          "ui_meta:",
          "  hermes-bots:",
          "    title: Emma",
          "  hermes-pocket:",
          "    private: true",
        ].join("\n"),
        "utf8"
      );
      fs.writeFileSync(
        path.join(novaDir, "profile.yaml"),
        [
          "ui_meta:",
          "  hermes-pocket:",
          "    chief: true",
          "    pinned: false",
        ].join("\n"),
        "utf8"
      );
      fs.writeFileSync(
        path.join(isolatedDir, "config.yaml"),
        "agent:\n  bot_mode_protocol: false\n",
        "utf8"
      );

      const raw = JSON.stringify({
        profiles: [
          { name: "default", is_default: true },
          { name: "emma", ui_meta: { "hermes-bots": { title: "Emma" } } },
          { name: "nova-chief" },
          { name: "secret-bot" },
        ],
      });

      const enriched = JSON.parse(
        enrichProfilesPayloadWithPocketMeta(raw, tmpHome)
      ) as { profiles: Array<{ name: string; ui_meta?: Record<string, unknown> }> };

      expect(enriched.profiles[1].ui_meta).toEqual({
        "hermes-bots": { title: "Emma" },
        "hermes-pocket": { private: true },
      });
      expect(enriched.profiles[2].ui_meta).toEqual({
        "hermes-pocket": { chief: true, pinned: false },
      });
      expect(enriched.profiles[3].ui_meta).toEqual({
        "hermes-pocket": { private: true },
      });
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
