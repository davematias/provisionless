import { randomUUID } from "node:crypto";

import { createMiddleware } from "hono/factory";

/** Supported request log levels. */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

function isLogLevel(value: string): value is LogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "silent"
  );
}

/**
 * Parses LOG_LEVEL. Invalid values fall back to info, except under tests where the default is silent.
 */
export function parseLogLevel(
  value: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): LogLevel {
  if (value && isLogLevel(value)) {
    return value;
  }
  return nodeEnv === "test" ? "silent" : "info";
}

function shouldLog(configured: LogLevel, line: Exclude<LogLevel, "silent">): boolean {
  return configured !== "silent" && LEVELS[line] >= LEVELS[configured];
}

export interface RequestLoggerOptions {
  level?: LogLevel;
  /** Destination for log lines; defaults to console.log. */
  write?: (line: string) => void;
}

/**
 * Writes one JSON line per request with a request id, method, route, status, and duration. It never
 * reads or records headers, cookies, or bodies, so credentials and tokens cannot leak into logs.
 */
export function createRequestLogger(options: RequestLoggerOptions = {}) {
  const level = options.level ?? "info";
  const write = options.write ?? ((line: string) => console.log(line));

  return createMiddleware(async (c, next) => {
    const requestId = randomUUID();
    c.header("x-request-id", requestId);
    const started = performance.now();
    let status = 500;

    try {
      await next();
      status = c.res.status;
    } finally {
      const lineLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      if (shouldLog(level, lineLevel)) {
        write(
          JSON.stringify({
            level: lineLevel,
            msg: "request",
            requestId,
            method: c.req.method,
            route: c.req.routePath || "*",
            status,
            durationMs: Math.round(performance.now() - started),
          }),
        );
      }
    }
  });
}
