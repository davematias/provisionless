import type { User } from "@provisionless/core";

/**
 * Name of the cookie that carries the signed-in session.
 */
export const SESSION_COOKIE = "provisionless_session";
/**
 * Lifetime of a session token before the user must sign in again.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface UserStore {
  getUser(username: string): Promise<User | undefined>;
}

export interface SessionDependencies {
  users: UserStore;
  jwtSecret: string;
}

export interface AuthVariables {
  user: User;
}

export type AppEnv = { Variables: AuthVariables };
