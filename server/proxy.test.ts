// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHermesPocketServer } from "./index.js";

describe("Hermes Pocket BFF HTTP Proxy", () => {
  let upstream: http.Server;
  let bff: http.Server;
  let bffUrl: string;

  beforeAll(async () => {
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
});
