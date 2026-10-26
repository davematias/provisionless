import { afterEach, expect, it } from "vitest";

import nextConfig from "../../next.config.ts";
import { securityHeaders, type SecurityHeader } from "./security-headers.ts";

function headerMap(headers: SecurityHeader[]): Map<string, string> {
  return new Map(headers.map((header) => [header.key, header.value]));
}

function policy(options: Parameters<typeof securityHeaders>[0] = {}): string {
  return headerMap(securityHeaders(options)).get("Content-Security-Policy") ?? "";
}

const API_URL = "https://api.example.com/some/path";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_API_URL;
});

it("sends every baseline security header", () => {
  const headers = headerMap(securityHeaders());

  expect([...headers.keys()].sort()).toEqual(
    [
      "Content-Security-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ].sort(),
  );
  expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(headers.get("X-Frame-Options")).toBe("DENY");
  expect(headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
  expect(headers.get("Permissions-Policy")).toContain("camera=()");
  expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
  expect(headers.get("Permissions-Policy")).toContain("microphone=()");
});

it("locks the document down to its own origin", () => {
  const value = policy();

  expect(value).toContain("default-src 'self'");
  expect(value).toContain("frame-ancestors 'none'");
  expect(value).toContain("object-src 'none'");
  expect(value).toContain("base-uri 'self'");
  expect(value).toContain("form-action 'self'");
});

it("allows the inline scripts and styles Next.js and the theme script need", () => {
  const value = policy();

  expect(value).toContain("script-src 'self' 'unsafe-inline'");
  expect(value).toContain("style-src 'self' 'unsafe-inline'");
  expect(value).not.toContain("'unsafe-eval'");
});

it("allows the API origin but not its path in connect-src", () => {
  const value = policy({ apiUrl: API_URL });

  expect(value).toContain("connect-src 'self' https://api.example.com");
  expect(value).not.toContain("/some/path");
});

it("ignores an unparseable API URL", () => {
  expect(policy({ apiUrl: "not a url" })).toContain("connect-src 'self'");
});

it("relaxes eval and websocket sources for development only", () => {
  const value = policy({ isDevelopment: true });

  expect(value).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  expect(value).toContain("ws://localhost:*");
  expect(value).toContain("http://localhost:*");
});

it("serves the headers for every route through next.config", async () => {
  process.env.NEXT_PUBLIC_API_URL = API_URL;

  const rules = await nextConfig.headers?.();

  expect(rules).toHaveLength(1);
  expect(rules?.[0]?.source).toBe("/(.*)");
  const headers = headerMap(rules?.[0]?.headers ?? []);
  expect(headers.get("Content-Security-Policy")).toContain("https://api.example.com");
  expect(headers.get("X-Frame-Options")).toBe("DENY");
});
