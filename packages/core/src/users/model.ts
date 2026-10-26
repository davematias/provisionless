export interface User {
  username: string;
  id: string;
  passwordHash: string;
  email: string;
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
  email: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  pictureUrl?: string;
  enabled?: boolean;
}

/**
 * Checks for the single-`@`, dotted-domain shape Provisionless accepts. Written as scans rather
 * than one anchored regular expression so a long, failing address cannot backtrack badly.
 */
export function isValidEmailAddress(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) {
    return false;
  }
  const domain = value.slice(at + 1);
  const dot = domain.indexOf(".", 1);
  return dot !== -1 && dot < domain.length - 1;
}

export type PublicUser = Omit<User, "passwordHash" | "passwordChangedAt">;

/**
 * Drops password data so a user is safe to return over HTTP.
 */
export function toPublicUser(user: User): PublicUser {
  return {
    username: user.username,
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    firstName: user.firstName,
    lastName: user.lastName,
    pictureUrl: user.pictureUrl,
    enabled: user.enabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
