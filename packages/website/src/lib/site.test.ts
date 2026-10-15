import { expect, it } from "vitest";

import { DEFAULT_SITE_URL, GITHUB_URL, resolveSiteConfig } from "./site.ts";

it("uses defaults when no site URL is configured", () => {
  const config = resolveSiteConfig({});

  expect(config.name).toBe("Provisionless");
  expect(config.githubUrl).toBe(GITHUB_URL);
  expect(config.siteUrl).toBe(DEFAULT_SITE_URL);
});

it("uses the configured public site URL", () => {
  const config = resolveSiteConfig({ NEXT_PUBLIC_SITE_URL: "https://provisionless.dev" });

  expect(config.siteUrl).toBe("https://provisionless.dev");
});

it("ignores a blank site URL", () => {
  const config = resolveSiteConfig({ NEXT_PUBLIC_SITE_URL: "   " });

  expect(config.siteUrl).toBe(DEFAULT_SITE_URL);
});
