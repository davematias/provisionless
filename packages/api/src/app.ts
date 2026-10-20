import { Hono } from "hono";
import { cors } from "hono/cors";
import { describeRoute, openAPIRouteHandler } from "hono-openapi";

import { registerAuthRoutes, type AuthDependencies } from "./auth/routes.ts";
import { SESSION_COOKIE, type AppEnv } from "./auth/session.ts";
import { registerContentRoutes } from "./content/routes.ts";
import type { ContentEntryStore, ContentTypeStore } from "./content/store.ts";
import { jsonResponse } from "./openapi/helpers.ts";
import { HealthResponseSchema } from "./openapi/schemas.ts";
import { registerUserRoutes } from "./users/routes.ts";

export interface AppDependencies extends AuthDependencies {
  contentTypes: ContentTypeStore;
  contentEntries: ContentEntryStore;
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

  app.get(
    "/health",
    describeRoute({
      tags: ["Health"],
      summary: "Liveness check",
      operationId: "getHealth",
      responses: {
        200: jsonResponse(HealthResponseSchema, "Service is healthy"),
      },
    }),
    (c) => c.json({ status: "ok" }),
  );
  registerAuthRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerContentRoutes(app, deps);

  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      exclude: ["/openapi.json"],
      documentation: {
        openapi: "3.0.3",
        info: {
          title: "Provisionless API",
          version: "0.0.0",
          description: "Content, authentication, and user management API for Provisionless.",
        },
        components: {
          securitySchemes: {
            cookieAuth: {
              type: "apiKey",
              in: "cookie",
              name: SESSION_COOKIE,
              description: "Session cookie set by POST /auth/login.",
            },
          },
        },
      },
    }),
  );

  return app;
}

export type AppType = ReturnType<typeof createApp>;
