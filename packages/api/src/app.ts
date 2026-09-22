import { Hono } from "hono";

import { registerAuthRoutes, type AuthDependencies } from "./auth/routes.ts";

export type AppDependencies = AuthDependencies;

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));
  registerAuthRoutes(app, deps);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
