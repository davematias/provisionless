import { serve } from "@hono/node-server";
import { createResetTokenRepository, createUserRepository } from "@provisionless/core";

import { createApp, parseAllowOrigins, parseCookieSameSite } from "./app.ts";

const app = createApp({
  users: createUserRepository(process.env.USERS_TABLE_NAME ?? "provisionless-users"),
  resetTokens: createResetTokenRepository(
    process.env.RESET_TOKENS_TABLE_NAME ?? "provisionless-reset-tokens",
  ),
  jwtSecret: process.env.JWT_SECRET ?? "insecure-development-secret",
  secureCookies: process.env.AUTH_COOKIE_SECURE === "true",
  cookieSameSite: parseCookieSameSite(process.env.AUTH_COOKIE_SAMESITE),
  corsAllowOrigins: parseAllowOrigins(process.env.AUTH_ALLOW_ORIGINS),
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Provisionless API listening on http://localhost:${info.port}`);
});
