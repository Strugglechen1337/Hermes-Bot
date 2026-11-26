import fs from "node:fs";
import path from "node:path";

export interface ServerConfig {
  hermesBaseUrl: string;
  host: string;
  port: number;
  cookieSecure: "auto" | "true" | "false";
  staticDir: string;
}

export function loadDotEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function resolveConfig(cwd = process.cwd()): ServerConfig {
  const fileEnv = loadDotEnv(path.resolve(cwd, ".env"));
  const env = { ...fileEnv, ...process.env };

  const rawBase = (env.HERMES_BASE_URL || "http://127.0.0.1:9130").trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(rawBase);
  } catch {
    throw new Error(`Ungültige HERMES_BASE_URL: "${rawBase}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`HERMES_BASE_URL muss http:// oder https:// verwenden.`);
  }

  const port = Number(env.PORT || 9135);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Ungültiger PORT: "${env.PORT}"`);
  }

  const cookieSecureRaw = (env.COOKIE_SECURE || "auto").toLowerCase();
  const cookieSecure: "auto" | "true" | "false" =
    cookieSecureRaw === "true" || cookieSecureRaw === "false" ? cookieSecureRaw : "auto";

  return {
    hermesBaseUrl: parsed.origin,
    host: (env.HOST || "127.0.0.1").trim(),
    port,
    cookieSecure,
    staticDir: path.resolve(cwd, "dist"),
  };
}
