export const DEFAULT_ADMIN_BASE_URL = "http://localhost:3001";

/**
 * Builds the link users open to choose a new password. Emailed and manually shared links must use
 * the same admin route so both flows meet the same page.
 */
export function buildResetUrl(adminBaseUrl: string, token: string): string {
  let end = adminBaseUrl.length;
  while (end > 0 && adminBaseUrl[end - 1] === "/") {
    end -= 1;
  }
  return `${adminBaseUrl.slice(0, end)}/reset?token=${encodeURIComponent(token)}`;
}
