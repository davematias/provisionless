import { randomUUID } from "node:crypto";

import { createMiddleware } from "hono/factory";
import { pino } from "pino";

/** Supported request log levels. */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

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

export interface RequestLoggerOptions {
  level?: LogLevel;
  /** Destination for log lines; defaults to stdout. */
  write?: (line: string) => void;
}

/**
 * Writes one JSON line per request with a request id, method, route, status, and duration. It never
 * reads or records headers, cookies, or bodies, so credentials and tokens cannot leak into logs.
 */
export function createRequestLogger(options: RequestLoggerOptions = {}) {
  const logger = pino(
    {
      level: options.level ?? "info",
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    options.write ? { write: options.write } : undefined,
  );

  return createMiddleware(async (c, next) => {
    const requestId = randomUUID();
    c.header("x-request-id", requestId);
    const requestLogger = logger.child({ requestId });
    const started = performance.now();
    let status = 500;

    try {
      await next();
      status = c.res.status;
    } finally {
      const lineLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      requestLogger[lineLevel](
        {
          method: c.req.method,
          route: c.req.routePath || "*",
          status,
          durationMs: Math.round(performance.now() - started),
        },
        "request",
      );
    }
  });
}
