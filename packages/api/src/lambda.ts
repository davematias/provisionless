import { createResetTokenRepository, createUserRepository } from "@provisionless/core";
import { handle } from "hono/aws-lambda";

import { createApp, parseAllowOrigins, parseCookieSameSite } from "./app.ts";
import { createEmailProviderFromEnv, createResetEmailDelivery } from "./email/provider.ts";

const emailProvider = createEmailProviderFromEnv({ env: process.env });

const app = createApp({
  users: createUserRepository(process.env.USERS_TABLE_NAME ?? "provisionless-users"),
  resetTokens: createResetTokenRepository(
    process.env.RESET_TOKENS_TABLE_NAME ?? "provisionless-reset-tokens",
  ),
  deliverReset: createResetEmailDelivery({
    provider: emailProvider,
    adminBaseUrl: process.env.ADMIN_BASE_URL ?? "http://localhost:3001",
  }),
  jwtSecret: process.env.JWT_SECRET ?? "insecure-development-secret",
  secureCookies: process.env.AUTH_COOKIE_SECURE !== "false",
  cookieSameSite: parseCookieSameSite(process.env.AUTH_COOKIE_SAMESITE),
  corsAllowOrigins: parseAllowOrigins(process.env.AUTH_ALLOW_ORIGINS),
});

export const handler = handle(app);
