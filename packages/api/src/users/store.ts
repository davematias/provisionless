import type { NewUser, UpdateUserInput, User } from "@provisionless/core";

import type { UserStore } from "../auth/session.ts";

export interface UserManagementStore extends UserStore {
  createUser(input: NewUser): Promise<User>;
  listUsers(): Promise<User[]>;
  updateUser(username: string, changes: UpdateUserInput): Promise<User>;
}
