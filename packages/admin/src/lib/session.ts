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
