import { Hono } from "hono";
import { expect, it } from "vitest";

import { createRequestLogger, parseLogLevel, type LogLevel } from "./logging.ts";

function appWithLogger(level: LogLevel, write: (line: string) => void): Hono {
  const app = new Hono();
  app.use("*", createRequestLogger({ level, write }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.post("/auth/login", (c) => c.json({ ok: true }));
  app.get("/boom", (c) => c.text("boom", 500));
  return app;
}

it("defaults to info in production and silent under tests", () => {
  expect(parseLogLevel(undefined, "production")).toBe("info");
  expect(parseLogLevel(undefined, "test")).toBe("silent");
  expect(parseLogLevel("debug", "production")).toBe("debug");
  expect(parseLogLevel("warn", "production")).toBe("warn");
  expect(parseLogLevel("garbage", "production")).toBe("info");
});

it("writes one structured line with a request id", async () => {
  const lines: string[] = [];
  const app = appWithLogger("info", (line) => lines.push(line));

  const response = await app.request("/health");

  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toBeTruthy();
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  expect(entry).toMatchObject({
    level: "info",
    msg: "request",
    method: "GET",
    route: "/health",
    status: 200,
  });
  expect(entry.requestId).toBe(response.headers.get("x-request-id"));
  expect(typeof entry.durationMs).toBe("number");
  expect(entry.durationMs).toBeGreaterThanOrEqual(0);
});

it("never logs headers, bodies, cookies, or query values", async () => {
  const lines: string[] = [];
  const app = appWithLogger("info", (line) => lines.push(line));

  await app.request("/auth/login?token=query-secret", {
    method: "POST",
    headers: {
      authorization: "Bearer header-secret",
      cookie: "provisionless_session=cookie-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: "ada",
      password: "password-secret",
      resetLink: "https://example.test/reset?token=body-secret",
    }),
  });

  const output = lines.join("\n");
  expect(output).toContain('"route":"/auth/login"');
  expect(output).not.toContain("header-secret");
  expect(output).not.toContain("cookie-secret");
  expect(output).not.toContain("password-secret");
  expect(output).not.toContain("body-secret");
  expect(output).not.toContain("query-secret");
});

it("filters lines by the configured level", async () => {
  const warnLines: string[] = [];
  const warnApp = appWithLogger("warn", (line) => warnLines.push(line));

  await warnApp.request("/health");
  expect(warnLines).toEqual([]);
  await warnApp.request("/missing");
  expect(warnLines).toHaveLength(1);
  expect(JSON.parse(warnLines[0] ?? "{}")).toMatchObject({ level: "warn", status: 404 });

  const errorLines: string[] = [];
  const errorApp = appWithLogger("error", (line) => errorLines.push(line));

  await errorApp.request("/missing");
  expect(errorLines).toEqual([]);
  await errorApp.request("/boom");
  expect(errorLines).toHaveLength(1);
  expect(JSON.parse(errorLines[0] ?? "{}")).toMatchObject({ level: "error", status: 500 });
});
