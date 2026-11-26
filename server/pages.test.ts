// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHermesPocketServer } from "./index.js";

describe("Hermes Pocket Pages BFF route", () => {
  let upstream: http.Server;
  let bff: http.Server;
  let bffUrl: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-pages-test-"));
    process.env.PUSH_DATA_DIR = tempDir;

    const pagesDir = path.join(tempDir, "pages");
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(
      path.join(pagesDir, "tagesbriefing-20261126-a1b2c3.html"),
      "<!doctype html><html><body><h1>Tagesbriefing</h1></body></html>",
      "utf8"
    );
    fs.writeFileSync(
      path.join(pagesDir, "tagesbriefing-20261126-a1b2c3.json"),
      JSON.stringify({
        id: "tagesbriefing-20261126-a1b2c3",
        title: "Dein Tagesbriefing",
        summary: "Welt, Wirtschaft und Wetter im Überblick",
        bot: "lea-news",
        createdAt: 1_764_180_000_000,
      }),
      "utf8"
    );

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
    delete process.env.PUSH_DATA_DIR;
  });

  it("blocks unauthenticated requests to pocket pages with 401", async () => {
    const res = await fetch(`${bffUrl}/api/pocket/pages/tagesbriefing-20261126-a1b2c3`);
    expect(res.status).toBe(401);
  });

  it("serves published HTML with opaque-origin CSP sandbox and no-store cache", async () => {
    const res = await fetch(`${bffUrl}/api/pocket/pages/tagesbriefing-20261126-a1b2c3`, {
      headers: { Cookie: "hermes_access=valid" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") || "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("<h1>Tagesbriefing</h1>");
  });

  it("lists published pages metadata and rejects invalid/traversal IDs", async () => {
    const listRes = await fetch(`${bffUrl}/api/pocket/pages`, {
      headers: { Cookie: "hermes_access=valid" },
    });
    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as { pages: Array<{ id: string; title: string }> };
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].title).toBe("Dein Tagesbriefing");

    const badRes = await fetch(`${bffUrl}/api/pocket/pages/..%2F.env`, {
      headers: { Cookie: "hermes_access=valid" },
    });
    expect(badRes.status).toBe(404);
  });
});
