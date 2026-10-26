export interface SecurityHeaderOptions {
  /** Public API origin the admin app calls; only its origin is added to connect-src. */
  apiUrl?: string;
  /** Allows the extra eval and websocket sources Next.js development needs. Defaults to false. */
  isDevelopment?: boolean;
}

/** A single response header, shaped for Next.js's `headers()` configuration. */
export interface SecurityHeader {
  key: string;
  value: string;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function contentSecurityPolicy(options: SecurityHeaderOptions): string {
  const isDevelopment = options.isDevelopment ?? false;
  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (isDevelopment) {
    scriptSources.push("'unsafe-eval'");
  }

  const connectSources = ["'self'"];
  const apiOrigin = originOf(options.apiUrl);
  if (apiOrigin) {
    connectSources.push(apiOrigin);
  }
  if (isDevelopment) {
    connectSources.push("ws://localhost:*", "http://localhost:*");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}

/**
 * Baseline browser hardening for every page and asset Next.js serves. Inline scripts and styles are
 * allowed because the App Router bootstraps with inline scripts and the design system theme script
 * runs before hydration; a nonce-based policy would force every page to render dynamically.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    {
      key: "Permissions-Policy",
      value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    },
  ];
}
