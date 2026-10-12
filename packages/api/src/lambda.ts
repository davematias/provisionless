import { createUserRepository } from "@provisionless/core";
import { handle } from "hono/aws-lambda";

import { createApp, parseAllowOrigins, parseCookieSameSite } from "./app.ts";

const app = createApp({
  users: createUserRepository(process.env.USERS_TABLE_NAME ?? "provisionless-users"),
  jwtSecret: process.env.JWT_SECRET ?? "insecure-development-secret",
  secureCookies: process.env.AUTH_COOKIE_SECURE !== "false",
  cookieSameSite: parseCookieSameSite(process.env.AUTH_COOKIE_SAMESITE),
  corsAllowOrigins: parseAllowOrigins(process.env.AUTH_ALLOW_ORIGINS),
});

export const handler = handle(app);
