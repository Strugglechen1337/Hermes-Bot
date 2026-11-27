import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHermesPocketServer } from "./index.js";

describe("bookmarks API", () => {
  const servers: http.Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("creates, lists, and deletes persisted bookmarks with Hermes session auth", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-bm-test-"));
    tempDirs.push(tmpDir);
    process.env.PUSH_DATA_DIR = tmpDir;

    const fakeHermes = http.createServer((req, res) => {
      if (req.url === "/api/auth/me" && req.headers.cookie?.includes("session=ok")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ authenticated: true, username: "user" }));
        return;
      }
      res.writeHead(401);
      res.end();
    });
    await new Promise<void>((r) => fakeHermes.listen(0, "127.0.0.1", r));
    servers.push(fakeHermes);
    const hermesPort = (fakeHermes.address() as { port: number }).port;

    const bff = createHermesPocketServer({
      host: "127.0.0.1",
      port: 0,
      hermesBaseUrl: `http://127.0.0.1:${hermesPort}`,
      staticDir: tmpDir,
      cookieSecure: "false",
    });
    await new Promise<void>((r) => bff.listen(0, "127.0.0.1", r));
    servers.push(bff);
    const bffPort = (bff.address() as { port: number }).port;
    const base = `http://127.0.0.1:${bffPort}`;

    const headers = {
      Cookie: "session=ok",
      Origin: base,
      "Content-Type": "application/json",
    };

    const createRes = await fetch(`${base}/api/pocket/bookmarks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        bot: "mia-einkauf",
        author: "Mia",
        text: "PS Portal Zielpreis: 210 €",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { bookmark: { id: string; text: string } };
    expect(created.bookmark.text).toBe("PS Portal Zielpreis: 210 €");

    const listRes = await fetch(`${base}/api/pocket/bookmarks`, { headers });
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { bookmarks: Array<{ id: string }> };
    expect(listed.bookmarks).toHaveLength(1);

    const delRes = await fetch(`${base}/api/pocket/bookmarks/${created.bookmark.id}`, {
      method: "DELETE",
      headers,
    });
    expect(delRes.status).toBe(200);

    const listAfter = await fetch(`${base}/api/pocket/bookmarks`, { headers });
    const listedAfter = (await listAfter.json()) as { bookmarks: Array<{ id: string }> };
    expect(listedAfter.bookmarks).toHaveLength(0);
  });
});
