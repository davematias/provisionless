import { expect, it } from "vitest";

import {
  adminAssetPath,
  verifyAdmin,
  verifyDeployment,
  verifyLogin,
  verifyOpenApi,
  type Fetch,
} from "./e2e-verify.ts";

const API_URL = "https://api.example.com";
const ADMIN_URL = "https://admin.example.com";
const ADMIN_HTML = '<html><script src="/_next/static/chunks/app.js"></script></html>';
const CSP = "default-src 'self'; connect-src 'self' https://api.example.com";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function page(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });
}

it("checks the deployed API serves the OpenAPI document", async () => {
  const calls: string[] = [];
  const request: Fetch = async (url) => {
    calls.push(url);
    return json({ openapi: "3.0.3", paths: { "/health": {} } });
  };

  await verifyOpenApi(API_URL, request);

  expect(calls).toEqual(["https://api.example.com/openapi.json"]);
});

it("rejects an OpenAPI document with the wrong version or no paths", async () => {
  await expect(
    verifyOpenApi(API_URL, async () => json({ openapi: "2.0", paths: { "/health": {} } })),
  ).rejects.toThrow(/expected 3\.0\.3/u);
  await expect(
    verifyOpenApi(API_URL, async () => json({ openapi: "3.0.3", paths: {} })),
  ).rejects.toThrow(/lists no API paths/u);
});

it("reports an unavailable OpenAPI document", async () => {
  await expect(
    verifyOpenApi(API_URL, async () => new Response("", { status: 502 })),
  ).rejects.toThrow(/GET https:\/\/api\.example\.com\/openapi\.json returned HTTP 502/u);
});

it("signs in the seeded test user", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request: Fetch = async (url, init) => {
    calls.push({ url, init });
    return json({ user: { username: "e2e-admin" } });
  };

  await verifyLogin({ apiUrl: API_URL, username: "e2e-admin", password: "secret" }, request);

  expect(calls.map((call) => call.url)).toEqual(["https://api.example.com/auth/login"]);
  expect(calls[0]?.init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
    username: "e2e-admin",
    password: "secret",
  });
});

it("rejects a failed or unexpected login", async () => {
  await expect(
    verifyLogin(
      { apiUrl: API_URL, username: "e2e-admin", password: "secret" },
      async () => new Response("", { status: 401 }),
    ),
  ).rejects.toThrow(/returned HTTP 401/u);
  await expect(
    verifyLogin({ apiUrl: API_URL, username: "e2e-admin", password: "secret" }, async () =>
      json({ user: { username: "someone-else" } }),
    ),
  ).rejects.toThrow(/did not sign in "e2e-admin"/u);
});

it("finds the admin client asset", () => {
  expect(adminAssetPath(ADMIN_HTML)).toBe("/_next/static/chunks/app.js");
  expect(() => adminAssetPath("<html></html>")).toThrow(/does not reference/u);
});

it("checks the admin site CSP and client assets", async () => {
  const calls: string[] = [];
  const request: Fetch = async (url) => {
    calls.push(url);
    if (url === "https://admin.example.com/") {
      return page(ADMIN_HTML, { "content-security-policy": CSP });
    }
    return page("console.log('app')", { "content-type": "text/javascript" });
  };

  await verifyAdmin({ adminUrl: ADMIN_URL, apiUrl: API_URL }, request);

  expect(calls).toEqual([
    "https://admin.example.com/",
    "https://admin.example.com/_next/static/chunks/app.js",
  ]);
});

it("rejects an admin CSP that does not allow the deployed API origin", async () => {
  const request: Fetch = async () =>
    page(ADMIN_HTML, { "content-security-policy": "default-src 'self'; connect-src 'self'" });

  await expect(verifyAdmin({ adminUrl: ADMIN_URL, apiUrl: API_URL }, request)).rejects.toThrow(
    /does not allow the deployed API origin https:\/\/api\.example\.com/u,
  );
});

it("rejects an admin page without a CSP header or working assets", async () => {
  await expect(
    verifyAdmin({ adminUrl: ADMIN_URL, apiUrl: API_URL }, async () => page(ADMIN_HTML)),
  ).rejects.toThrow(/did not return a Content-Security-Policy/u);

  const request: Fetch = async (url) =>
    url === "https://admin.example.com/"
      ? page(ADMIN_HTML, { "content-security-policy": CSP })
      : new Response("", { status: 404 });
  await expect(verifyAdmin({ adminUrl: ADMIN_URL, apiUrl: API_URL }, request)).rejects.toThrow(
    /client asset .* returned HTTP 404/u,
  );
});

it("runs every deployment check", async () => {
  const calls: string[] = [];
  const request: Fetch = async (url) => {
    calls.push(url);
    if (url.endsWith("/openapi.json")) {
      return json({ openapi: "3.0.3", paths: { "/health": {} } });
    }
    if (url.endsWith("/auth/login")) {
      return json({ user: { username: "e2e-admin" } });
    }
    if (url === "https://admin.example.com/") {
      return page(ADMIN_HTML, { "content-security-policy": CSP });
    }
    return page("asset");
  };

  await verifyDeployment({
    apiUrl: API_URL,
    adminUrl: ADMIN_URL,
    username: "e2e-admin",
    password: "secret",
    fetch: request,
  });

  expect(calls).toEqual([
    "https://api.example.com/openapi.json",
    "https://api.example.com/auth/login",
    "https://admin.example.com/",
    "https://admin.example.com/_next/static/chunks/app.js",
  ]);
});
