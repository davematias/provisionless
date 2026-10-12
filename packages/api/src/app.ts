import { Hono } from "hono";
import { cors } from "hono/cors";

import { registerAuthRoutes, type AuthDependencies } from "./auth/routes.ts";
import type { AppEnv } from "./auth/session.ts";

export interface AppDependencies extends AuthDependencies {
  corsAllowOrigins?: string[];
}

export function parseAllowOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function parseCookieSameSite(value: string | undefined): "Lax" | "None" {
  return value === "None" ? "None" : "Lax";
}

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const origins = deps.corsAllowOrigins ?? [];
  if (origins.length > 0) {
    app.use("*", cors({ origin: origins, credentials: true, maxAge: 3600 }));
  }

  app.get("/health", (c) => c.json({ status: "ok" }));
  registerAuthRoutes(app, deps);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
