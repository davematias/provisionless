import {
  isValidEmailAddress,
  type NewUser,
  type UpdateUserInput,
  type User,
} from "@provisionless/core";

import type { UserManagementStore } from "./store.ts";

/** Raised when an operation targets a username that no user has. */
export class UserNotFoundError extends Error {
  constructor(username: string) {
    super(`User "${username}" was not found`);
    this.name = "UserNotFoundError";
  }
}

/** Raised when a user payload has missing or malformed fields; the message is safe to return. */
export class InvalidUserFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUserFieldError";
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * User management use cases: listing, creation, and partial updates. Fields are validated here so
 * routes only translate HTTP requests into plain objects and back.
 */
export class UserService {
  readonly #store: UserManagementStore;

  constructor(store: UserManagementStore) {
    this.#store = store;
  }

  /** Lists every user ordered by username. */
  async listUsers(): Promise<User[]> {
    const users = await this.#store.listUsers();
    return users.sort((left, right) => left.username.localeCompare(right.username));
  }

  /**
   * Creates a user from untrusted request fields, defaulting `isAdmin` to false and `enabled` to
   * true.
   *
   * @throws {InvalidUserFieldError} When a required field is missing or malformed.
   * @throws {UsernameTakenError} When the username already exists.
   */
  async createUser(body: Record<string, unknown>): Promise<User> {
    const username = readString(body.username)?.trim();
    const password = readString(body.password);
    const email = readString(body.email)?.trim();
    const firstName = readString(body.firstName)?.trim();
    const lastName = readString(body.lastName)?.trim();
    if (!username || !password || !email || !firstName || !lastName) {
      throw new InvalidUserFieldError(
        "username, password, email, firstName, and lastName are required",
      );
    }
    if (!isValidEmailAddress(email)) {
      throw new InvalidUserFieldError("Invalid email address");
    }

    const isAdmin = body.isAdmin ?? false;
    const enabled = body.enabled ?? true;
    if (typeof isAdmin !== "boolean" || typeof enabled !== "boolean") {
      throw new InvalidUserFieldError("isAdmin and enabled must be booleans");
    }

    const input: NewUser = {
      username,
      password,
      email,
      firstName,
      lastName,
      isAdmin,
      enabled,
    };
    return this.#store.createUser(input);
  }

  /**
   * Applies the supported fields present in a request body to an existing user. Validation happens
   * before the lookup, so malformed fields are rejected even for unknown usernames.
   *
   * @throws {InvalidUserFieldError} When a supplied field is malformed or no supported field is set.
   * @throws {UserNotFoundError} When no user has the given username.
   */
  async updateUser(username: string, body: Record<string, unknown>): Promise<User> {
    const changes: UpdateUserInput = {};
    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        throw new InvalidUserFieldError("enabled must be a boolean");
      }
      changes.enabled = body.enabled;
    }
    if ("isAdmin" in body) {
      if (typeof body.isAdmin !== "boolean") {
        throw new InvalidUserFieldError("isAdmin must be a boolean");
      }
      changes.isAdmin = body.isAdmin;
    }
    if ("email" in body) {
      const email = readString(body.email)?.trim();
      if (!email || !isValidEmailAddress(email)) {
        throw new InvalidUserFieldError("Invalid email address");
      }
      changes.email = email;
    }
    if ("firstName" in body) {
      const firstName = readString(body.firstName)?.trim();
      if (!firstName) {
        throw new InvalidUserFieldError("firstName must not be empty");
      }
      changes.firstName = firstName;
    }
    if ("lastName" in body) {
      const lastName = readString(body.lastName)?.trim();
      if (!lastName) {
        throw new InvalidUserFieldError("lastName must not be empty");
      }
      changes.lastName = lastName;
    }

    if (Object.keys(changes).length === 0) {
      throw new InvalidUserFieldError("No supported fields to update");
    }

    const existing = await this.#store.getUser(username);
    if (!existing) {
      throw new UserNotFoundError(username);
    }
    return this.#store.updateUser(username, changes);
  }
}
