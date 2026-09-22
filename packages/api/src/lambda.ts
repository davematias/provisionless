import { createUserRepository } from "@provisionless/core";
import { handle } from "hono/aws-lambda";

import { createApp } from "./app.ts";

const app = createApp({
  users: createUserRepository(process.env.USERS_TABLE_NAME ?? "provisionless-users"),
  jwtSecret: process.env.JWT_SECRET ?? "insecure-development-secret",
  secureCookies: process.env.AUTH_COOKIE_SECURE !== "false",
});

export const handler = handle(app);
