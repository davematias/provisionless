export interface SiteConfig {
  name: string;
  description: string;
  githubUrl: string;
  siteUrl: string;
}

export const DEFAULT_SITE_URL = "http://localhost:3000";

export const GITHUB_URL = "https://github.com/davematias/provisionless";

export type SiteEnv = Record<string, string | undefined>;

export function resolveSiteConfig(env: SiteEnv = process.env): SiteConfig {
  const configuredUrl = env.NEXT_PUBLIC_SITE_URL?.trim();
  return {
    name: "Provisionless",
    description: "A serverless, headless CMS.",
    githubUrl: GITHUB_URL,
    siteUrl: configuredUrl && configuredUrl !== "" ? configuredUrl : DEFAULT_SITE_URL,
  };
}

export const site = resolveSiteConfig();
