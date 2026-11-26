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
});
