import { verifyPassword, type User } from "@provisionless/core";

import { UserNotFoundError } from "../users/service.ts";
import type { UserManagementStore } from "../users/store.ts";
import { signSession } from "./jwt.ts";
import { buildResetUrl, DEFAULT_ADMIN_BASE_URL } from "./reset-link.ts";
import { SESSION_TTL_SECONDS } from "./session.ts";

export interface ResetTokenStore {
  create(username: string): Promise<string>;
  consume(token: string): Promise<string | undefined>;
}

export interface AuthServiceDependencies {
  users: UserManagementStore;
  resetTokens: ResetTokenStore;
  jwtSecret: string;
  deliverReset?: (user: User, token: string) => void | Promise<void>;
  adminBaseUrl?: string;
}

/** A verified user paired with a freshly signed session token. */
export interface LoginResult {
  user: User;
  token: string;
}

/** A one-use password reset link for a user. */
export interface ResetLink {
  username: string;
  url: string;
}

/**
 * Authentication use cases: credential checks, session token issuance, and the password reset
 * flows. Cookie handling and HTTP status codes stay in the route layer.
 */
export class AuthService {
  readonly #deps: AuthServiceDependencies;

  constructor(deps: AuthServiceDependencies) {
    this.#deps = deps;
  }

  /** Signs a session token for an already authenticated user. */
  async createSessionToken(user: User): Promise<string> {
    return await signSession(
      { username: user.username, passwordChangedAt: user.passwordChangedAt },
      this.#deps.jwtSecret,
      SESSION_TTL_SECONDS,
    );
  }

  /**
   * Verifies credentials and issues a session token. Disabled users and unknown usernames both
   * fail the same way so callers cannot probe for accounts.
   */
  async login(username: string, password: string): Promise<LoginResult | undefined> {
    const user = await this.#deps.users.getUser(username);
    const valid =
      user !== undefined && user.enabled && (await verifyPassword(password, user.passwordHash));
    if (!user || !valid) {
      return undefined;
    }
    return { user, token: await this.createSessionToken(user) };
  }

  /**
   * Creates a reset token and hands it to the delivery hook when the username exists. Unknown
   * usernames are ignored so the HTTP response stays identical either way.
   */
  async requestPasswordReset(username: string): Promise<void> {
    const user = await this.#deps.users.getUser(username);
    if (!user) {
      return;
    }
    const token = await this.#deps.resetTokens.create(user.username);
    await this.#deps.deliverReset?.(user, token);
  }

  /**
   * Creates a reset token and returns the link an admin can share manually.
   *
   * @throws {UserNotFoundError} When no user has the given username.
   */
  async createResetLink(username: string): Promise<ResetLink> {
    const target = await this.#deps.users.getUser(username);
    if (!target) {
      throw new UserNotFoundError(username);
    }
    const token = await this.#deps.resetTokens.create(target.username);
    const baseUrl = this.#deps.adminBaseUrl ?? DEFAULT_ADMIN_BASE_URL;
    return { username: target.username, url: buildResetUrl(baseUrl, token) };
  }

  /**
   * Consumes a reset token and sets the new password, which invalidates the user's existing
   * sessions.
   *
   * @returns `false` when the token is unknown, already used, or expired.
   */
  async confirmPasswordReset(token: string, password: string): Promise<boolean> {
    const username = await this.#deps.resetTokens.consume(token);
    const user = username ? await this.#deps.users.getUser(username) : undefined;
    if (!user) {
      return false;
    }
    await this.#deps.users.updateUser(user.username, { password });
    return true;
  }
}
