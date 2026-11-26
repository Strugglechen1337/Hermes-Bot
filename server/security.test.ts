import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  adaptSetCookieHeader,
  isAllowedHermesPath,
  isSameOriginRequest,
} from "./security.js";

describe("isAllowedHermesPath", () => {
  it("allows documented Hermes endpoints with expected HTTP methods", () => {
    expect(isAllowedHermesPath("GET", "/api/status")).toBe(true);
    expect(isAllowedHermesPath("POST", "/auth/password-login")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/auth/me")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/profiles")).toBe(true);
    expect(isAllowedHermesPath("POST", "/api/profiles")).toBe(true);
    expect(isAllowedHermesPath("DELETE", "/api/profiles/coach")).toBe(true);
    expect(isAllowedHermesPath("PUT", "/api/profiles/coach/soul")).toBe(true);
    expect(isAllowedHermesPath("PUT", "/api/profiles/coach/description")).toBe(true);
    expect(isAllowedHermesPath("PUT", "/api/profiles/coach/model")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/model/options")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/model/info")).toBe(true);
    expect(isAllowedHermesPath("POST", "/api/model/set")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/sessions")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/sessions/abc-123/messages")).toBe(true);
    expect(isAllowedHermesPath("POST", "/api/chat/file-upload")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/cron/jobs")).toBe(true);
    expect(isAllowedHermesPath("POST", "/api/cron/jobs/job1/pause")).toBe(true);
    expect(isAllowedHermesPath("POST", "/api/cron/jobs/job1/resume")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/messaging/platforms")).toBe(true);
    expect(isAllowedHermesPath("PUT", "/api/messaging/platforms/email")).toBe(true);
    expect(isAllowedHermesPath("POST", "/api/messaging/platforms/email/test")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/mcp/servers")).toBe(true);
    expect(isAllowedHermesPath("PUT", "/api/mcp/servers/gmail/enabled")).toBe(true);
    expect(isAllowedHermesPath("POST", "/api/mcp/servers/gmail/auth")).toBe(true);
    expect(isAllowedHermesPath("GET", "/api/mcp/catalog")).toBe(true);
  });

  it("blocks unlisted endpoints, path traversal, and disallowed verbs", () => {
    expect(isAllowedHermesPath("GET", "/api/env")).toBe(false);
    expect(isAllowedHermesPath("GET", "/api/config")).toBe(false);
    expect(isAllowedHermesPath("DELETE", "/api/profiles")).toBe(false);
    expect(isAllowedHermesPath("GET", "/api/sessions/../env")).toBe(false);
    expect(isAllowedHermesPath("POST", "/api/status")).toBe(false);
    expect(isAllowedHermesPath("GET", "/api/cron/fire")).toBe(false);
  });
});

describe("isSameOriginRequest", () => {
  it("allows GET requests and same-origin POST requests", () => {
    expect(
      isSameOriginRequest({ method: "GET", headers: {} } as IncomingMessage)
    ).toBe(true);

    expect(
      isSameOriginRequest({
        method: "POST",
        headers: {
          host: "hermes.local:9135",
          origin: "https://hermes.local:9135",
          "sec-fetch-site": "same-origin",
        },
      } as unknown as IncomingMessage)
    ).toBe(true);
  });

  it("rejects cross-site or mismatched-origin mutations", () => {
    expect(
      isSameOriginRequest({
        method: "POST",
        headers: {
          host: "hermes.local:9135",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
      } as unknown as IncomingMessage)
    ).toBe(false);

    expect(
      isSameOriginRequest({
        method: "PUT",
        headers: {
          host: "hermes.local:9135",
          origin: "https://other-host:9135",
        },
      } as unknown as IncomingMessage)
    ).toBe(false);
  });
});

describe("adaptSetCookieHeader", () => {
  it("strips Domain, keeps HttpOnly, and sets Secure only for HTTPS clients", () => {
    const raw =
      "hermes_session=abc123; Domain=upstream.internal; Path=/app; HttpOnly; SameSite=Lax; Secure";
    const httpsCookie = adaptSetCookieHeader(raw, true);
    expect(httpsCookie).toContain("hermes_session=abc123");
    expect(httpsCookie).toContain("HttpOnly");
    expect(httpsCookie).toContain("Path=/");
    expect(httpsCookie).toContain("SameSite=Lax");
    expect(httpsCookie).toContain("Secure");
    expect(httpsCookie).not.toContain("Domain=");

    const httpCookie = adaptSetCookieHeader(raw, false);
    expect(httpCookie).toContain("HttpOnly");
    expect(httpCookie).not.toContain("Secure");
  });
});
