import type { User } from "@provisionless/core";

export const SESSION_COOKIE = "provisionless_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionDependencies {
  users: { getUser(username: string): Promise<User | undefined> };
  jwtSecret: string;
}

export interface AuthVariables {
  user: User;
}

export type AppEnv = { Variables: AuthVariables };
