import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { resolveConfig, type ServerConfig } from "./config.js";
import { handleHermesHttpProxy } from "./proxy.js";
import { startHermesPushWatcher } from "./pushWatcher.js";
import { attachHermesWsBridge } from "./wsBridge.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStaticSpa(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string
): void {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  if (!fs.existsSync(staticDir)) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Hermes Pocket BFF läuft. Frontend im Dev-Modus über Vite starten oder `npm run build` ausführen.");
    return;
  }

  const parsedUrl = new URL(req.url || "/", "http://localhost");
  const rawPath = decodeURIComponent(parsedUrl.pathname);
  const safeRelative = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = path.join(staticDir, safeRelative === "/" ? "index.html" : safeRelative);

  let targetFile = candidate;
  if (!targetFile.startsWith(staticDir) || !fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
    targetFile = path.join(staticDir, "index.html");
  }

  if (!fs.existsSync(targetFile)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(targetFile).toLowerCase();
  const isImmutableAsset = rawPath.startsWith("/assets/");
  const headers: Record<string, string> = {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": isImmutableAsset
      ? "public, max-age=31536000, immutable"
      : "no-store, no-cache, must-revalidate",
  };

  res.writeHead(200, headers);
  if (method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(targetFile).pipe(res);
}

export function createHermesPocketServer(config: ServerConfig): http.Server {
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    void (async () => {
      const handled = await handleHermesHttpProxy(req, res, config);
      if (!handled) {
        serveStaticSpa(req, res, config.staticDir);
      }
    })();
  });

  server.on("upgrade", (req, socket, head) => {
    attachHermesWsBridge(wss, req, socket, head, config);
  });

  return server;
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]).replace(/\\/g, "/").endsWith("/index.js") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("/index.ts");

if (isEntrypoint) {
  const config = resolveConfig();
  const server = createHermesPocketServer(config);
  const pushWatcher = startHermesPushWatcher();
  server.on("close", () => {
    pushWatcher.stop();
  });
  server.listen(config.port, config.host, () => {
    // Log only bind host/port — never log secrets, tokens, or upstream credentials
    console.log(`[hermes-pocket] BFF listening on http://${config.host}:${config.port}`);
  });
}
