import { afterEach, expect, it, vi } from "vitest";

import { hasSession, isPublicPath, loginUrlFor, resolveRedirect } from "./session.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("treats the login and password-reset pages as public", () => {
  expect(isPublicPath("/login")).toBe(true);
  expect(isPublicPath("/login/forgot")).toBe(true);
  expect(isPublicPath("/reset-password")).toBe(true);
  expect(isPublicPath("/reset-password/abc")).toBe(true);
});

it("treats everything else as protected", () => {
  expect(isPublicPath("/")).toBe(false);
  expect(isPublicPath("/content")).toBe(false);
  expect(isPublicPath("/login-extra")).toBe(false);
  expect(isPublicPath("/reset-passwordish")).toBe(false);
});

it("builds an encoded login URL that remembers the requested page", () => {
  expect(loginUrlFor("/content")).toBe("/login?from=%2Fcontent");
  expect(loginUrlFor("/content/pages?draft=1")).toBe("/login?from=%2Fcontent%2Fpages%3Fdraft%3D1");
});

it("only allows internal redirect targets", () => {
  expect(resolveRedirect("/content")).toBe("/content");
  expect(resolveRedirect("/content/pages?draft=1")).toBe("/content/pages?draft=1");
  expect(resolveRedirect(null)).toBe("/");
  expect(resolveRedirect(undefined)).toBe("/");
  expect(resolveRedirect("/")).toBe("/");
  expect(resolveRedirect("")).toBe("/");
  expect(resolveRedirect("//evil.example")).toBe("/");
  expect(resolveRedirect("/\\evil.example")).toBe("/");
  expect(resolveRedirect("https://evil.example")).toBe("/");
  expect(resolveRedirect("content")).toBe("/");
});

it("reports a session only when the API confirms it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  await expect(hasSession("https://api.example.test")).resolves.toBe(true);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
  await expect(hasSession("https://api.example.test")).resolves.toBe(false);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("fetch failed");
    }),
  );
  await expect(hasSession("https://api.example.test")).resolves.toBe(false);

  await expect(hasSession(undefined)).resolves.toBe(false);
});

it("checks the session against the API me endpoint with credentials", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await hasSession("https://api.example.test");

  expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/auth/me", {
    credentials: "include",
  });
});
