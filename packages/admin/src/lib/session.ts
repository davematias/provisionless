export const DEFAULT_REDIRECT = "/";

export const PUBLIC_PATHS = ["/login", "/reset-password"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

export function loginUrlFor(pathname: string): string {
  return `/login?from=${encodeURIComponent(pathname)}`;
}

export function resolveRedirect(from: string | null | undefined): string {
  if (from === undefined || from === null || !/^\/[^/\\]/.test(from)) {
    return DEFAULT_REDIRECT;
  }
  return from;
}

export async function hasSession(apiUrl: string | undefined): Promise<boolean> {
  if (!apiUrl) {
    return false;
  }
  try {
    const response = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
    return response.ok;
  } catch {
    return false;
  }
}

export interface CurrentUser {
  username: string;
  id: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  pictureUrl?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function displayName(
  user: Pick<CurrentUser, "firstName" | "lastName" | "username">,
): string {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return name === "" ? user.username : name;
}

export async function fetchCurrentUser(
  apiUrl: string | undefined,
): Promise<CurrentUser | undefined> {
  if (!apiUrl) {
    return undefined;
  }
  try {
    const response = await fetch(`${apiUrl}/auth/me`, { credentials: "include" });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { user?: CurrentUser };
    return body.user;
  } catch {
    return undefined;
  }
}

export async function logout(apiUrl: string | undefined): Promise<boolean> {
  if (!apiUrl) {
    return false;
  }
  try {
    const response = await fetch(`${apiUrl}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    return response.ok;
  } catch {
    return false;
  }
}
