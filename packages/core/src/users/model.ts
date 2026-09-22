export interface User {
  username: string;
  id: string;
  passwordHash: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  pictureUrl?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string;
}

export interface NewUser {
  username: string;
  password: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  pictureUrl?: string;
  enabled?: boolean;
}

export type PublicUser = Omit<User, "passwordHash" | "passwordChangedAt">;

export function toPublicUser(user: User): PublicUser {
  return {
    username: user.username,
    id: user.id,
    isAdmin: user.isAdmin,
    firstName: user.firstName,
    lastName: user.lastName,
    pictureUrl: user.pictureUrl,
    enabled: user.enabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
