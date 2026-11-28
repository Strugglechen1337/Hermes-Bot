import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.js";
import { attachHermesWsBridge, heldBridgeCount } from "./wsBridge.js";

function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("timeout waiting for condition"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("wsBridge hold while a Hermes request is unanswered", () => {
  let hermes: http.Server;
  let hermesWss: WebSocketServer;
  let bff: http.Server;
  let bffWss: WebSocketServer;
  let bffPort = 0;
  let upstreamSockets: WebSocket[] = [];
  let upstreamClosed = 0;
  let upstreamReceived: string[] = [];

  beforeEach(async () => {
    upstreamSockets = [];
    upstreamClosed = 0;
    upstreamReceived = [];
    process.env.HERMES_POCKET_WS_HOLD_MS = "1500";

    hermes = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/auth/ws-ticket") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ticket: "t1" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    hermesWss = new WebSocketServer({ noServer: true });
    hermes.on("upgrade", (req, socket, head) => {
      hermesWss.handleUpgrade(req, socket, head, (ws) => {
        upstreamSockets.push(ws);
        ws.on("message", (d) => upstreamReceived.push(d.toString()));
        ws.on("close", () => {
          upstreamClosed += 1;
        });
      });
    });
    await new Promise<void>((r) => hermes.listen(0, "127.0.0.1", r));
    const hermesPort = (hermes.address() as AddressInfo).port;

    const config: ServerConfig = {
      hermesBaseUrl: `http://127.0.0.1:${hermesPort}`,
      host: "127.0.0.1",
      port: 0,
      cookieSecure: "false",
      staticDir: ".",
    };
    bffWss = new WebSocketServer({ noServer: true });
    bff = http.createServer();
    bff.on("upgrade", (req, socket, head) => attachHermesWsBridge(bffWss, req, socket, head, config));
    await new Promise<void>((r) => bff.listen(0, "127.0.0.1", r));
    bffPort = (bff.address() as AddressInfo).port;
  });

  afterEach(async () => {
    delete process.env.HERMES_POCKET_WS_HOLD_MS;
    for (const ws of upstreamSockets) ws.terminate();
    hermesWss.close();
    bffWss.close();
    await new Promise<void>((r) => hermes.close(() => r()));
    await new Promise<void>((r) => bff.close(() => r()));
  });

  function connectClient(): Promise<{ ws: WebSocket; messages: string[] }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${bffPort}/api/ws`, { headers: { cookie: "sid=abc" } });
      const messages: string[] = [];
      ws.on("message", (d) => messages.push(d.toString()));
      ws.on("open", () => resolve({ ws, messages }));
      ws.on("error", reject);
    });
  }

  const request = JSON.stringify({ jsonrpc: "2.0", id: "r1", method: "vault.code", params: { site: "x" } });

  it("keeps Hermes connected and replays the open request when the same user reconnects", async () => {
    const first = await connectClient();
    await waitFor(() => upstreamSockets.length === 1);
    upstreamSockets[0].send(request);
    await waitFor(() => first.messages.length === 1);

    first.ws.close(1000, "client_closed");
    await waitFor(() => heldBridgeCount() === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(upstreamClosed).toBe(0);

    const second = await connectClient();
    await waitFor(() => second.messages.length === 1);
    expect(JSON.parse(second.messages[0]).method).toBe("vault.code");
    expect(upstreamSockets).toHaveLength(1);
    expect(heldBridgeCount()).toBe(0);

    second.ws.send(JSON.stringify({ jsonrpc: "2.0", id: "r1", result: { value: "123456" } }));
    await waitFor(() => upstreamReceived.some((m) => m.includes("123456")));

    // Answered → a later disconnect closes Hermes normally (nothing to hold).
    second.ws.close(1000, "client_closed");
    await waitFor(() => upstreamClosed === 1);
    expect(heldBridgeCount()).toBe(0);
  });

  const submit = JSON.stringify({ jsonrpc: "2.0", id: "hp-1", method: "prompt.submit", params: { text: "x" } });
  const complete = JSON.stringify({
    jsonrpc: "2.0",
    method: "event",
    params: { type: "message.complete", payload: {} },
  });

  it("keeps Hermes connected while a prompt runs and delivers a code request that arrives after the drop", async () => {
    const first = await connectClient();
    await waitFor(() => upstreamSockets.length === 1);
    first.ws.send(submit);
    await waitFor(() => upstreamReceived.length === 1);

    first.ws.terminate();
    await waitFor(() => heldBridgeCount() === 1);

    // The agent asks for the 2FA code while the phone is away.
    upstreamSockets[0].send(request);
    await new Promise((r) => setTimeout(r, 150));
    expect(upstreamClosed).toBe(0);

    const second = await connectClient();
    await waitFor(() => second.messages.length === 1);
    expect(JSON.parse(second.messages[0]).method).toBe("vault.code");
    expect(upstreamSockets).toHaveLength(1);
  });

  it("lets go of a held connection when the turn completes while the phone is away", async () => {
    const first = await connectClient();
    await waitFor(() => upstreamSockets.length === 1);
    first.ws.send(submit);
    await waitFor(() => upstreamReceived.length === 1);
    first.ws.terminate();
    await waitFor(() => heldBridgeCount() === 1);

    upstreamSockets[0].send(complete);
    await waitFor(() => upstreamClosed === 1);
    expect(heldBridgeCount()).toBe(0);
  });

  it("closes Hermes right away when no request is open", async () => {
    const first = await connectClient();
    await waitFor(() => upstreamSockets.length === 1);
    first.ws.close(1000, "client_closed");
    await waitFor(() => upstreamClosed === 1);
    expect(heldBridgeCount()).toBe(0);
  });

  it("closes the held Hermes connection after the grace period", async () => {
    process.env.HERMES_POCKET_WS_HOLD_MS = "150";
    const first = await connectClient();
    await waitFor(() => upstreamSockets.length === 1);
    upstreamSockets[0].send(request);
    await waitFor(() => first.messages.length === 1);
    first.ws.close(1000, "client_closed");
    await waitFor(() => upstreamClosed === 1);
    expect(heldBridgeCount()).toBe(0);
  });
});
