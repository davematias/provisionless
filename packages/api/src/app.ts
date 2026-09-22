import { Hono } from "hono";

import { registerAuthRoutes, type AuthDependencies } from "./auth/routes.ts";
import type { AppEnv } from "./auth/session.ts";

export type AppDependencies = AuthDependencies;

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ status: "ok" }));
  registerAuthRoutes(app, deps);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
