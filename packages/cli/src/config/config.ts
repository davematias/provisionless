import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isValidAppPrefix } from "../aws/names.ts";
import type { Logger } from "../util/log.ts";
import { confirm, type Ask } from "../util/prompt.ts";

export const CONFIG_FILE = ".provisionless";

export interface ProvisionlessConfig {
  appPrefix: string;
  mediaBucket?: string;
  region?: string;
  adminDomain?: string;
  apiDomain?: string;
  hostedZone?: string;
}

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_FILE);
}

export function loadConfig(repoRoot: string): ProvisionlessConfig | undefined {
  try {
    const contents = readFileSync(configPath(repoRoot), "utf8");
    return JSON.parse(contents) as ProvisionlessConfig;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function saveConfig(repoRoot: string, config: ProvisionlessConfig): void {
  writeFileSync(configPath(repoRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function updateConfig(repoRoot: string, patch: Partial<ProvisionlessConfig>): void {
  saveConfig(repoRoot, { ...loadConfig(repoRoot), ...patch } as ProvisionlessConfig);
}

export interface ResolveRegionOptions {
  repoRoot: string;
  region?: string;
  ask: Ask;
  log: Logger;
  persist: boolean;
}

export async function resolveRegion(options: ResolveRegionOptions): Promise<string> {
  const existing = loadConfig(options.repoRoot);

  let region = options.region ?? existing?.region ?? process.env.AWS_REGION;
  if (!region) {
    const answer = (await options.ask("AWS region [us-east-1]: ")).trim();
    region = answer || "us-east-1";
  }

  if (options.persist) {
    updateConfig(options.repoRoot, { region });
  }
  return region;
}

export interface DomainConfig {
  adminDomain?: string;
  apiDomain?: string;
  hostedZone?: string;
}

export function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
}

function validateDomains(config: DomainConfig): void {
  const entries = [
    ["admin domain", config.adminDomain],
    ["api domain", config.apiDomain],
  ] as const;

  for (const [label, value] of entries) {
    if (value !== undefined && !isValidDomain(value)) {
      throw new Error(`Invalid ${label} "${value}".`);
    }
  }
}

export interface ResolveDomainsOptions {
  repoRoot: string;
  adminDomain?: string;
  apiDomain?: string;
  hostedZone?: string;
  noDomains?: boolean;
  ask: Ask;
  log: Logger;
  persist: boolean;
}

export async function resolveDomains(options: ResolveDomainsOptions): Promise<DomainConfig> {
  if (options.noDomains) {
    if (
      options.adminDomain !== undefined ||
      options.apiDomain !== undefined ||
      options.hostedZone !== undefined
    ) {
      throw new Error(
        "Cannot combine --no-domains with --admin-domain, --api-domain, or --hosted-zone.",
      );
    }
    options.log("skipping custom domain configuration");
    return {};
  }

  const existing = loadConfig(options.repoRoot);
  const hasFlag =
    options.adminDomain !== undefined ||
    options.apiDomain !== undefined ||
    options.hostedZone !== undefined;

  if (hasFlag) {
    const config: DomainConfig = {
      adminDomain: options.adminDomain ?? existing?.adminDomain,
      apiDomain: options.apiDomain ?? existing?.apiDomain,
      hostedZone: options.hostedZone ?? existing?.hostedZone,
    };
    validateDomains(config);
    if (options.persist) {
      updateConfig(options.repoRoot, {
        adminDomain: config.adminDomain,
        apiDomain: config.apiDomain,
        hostedZone: config.hostedZone,
      });
    }
    return config;
  }

  if (existing?.adminDomain || existing?.apiDomain) {
    const summary = [
      existing.adminDomain ? `admin ${existing.adminDomain}` : undefined,
      existing.apiDomain ? `api ${existing.apiDomain}` : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join(", ");
    const reuse = await confirm(options.ask, `Reuse saved domains (${summary})?`, true);
    if (reuse) {
      return {
        adminDomain: existing.adminDomain,
        apiDomain: existing.apiDomain,
        hostedZone: existing.hostedZone,
      };
    }
  }

  const adminAnswer = (await options.ask("Admin domain (blank for none): ")).trim();
  const apiAnswer = (await options.ask("API domain (blank for none): ")).trim();
  const zoneAnswer = (await options.ask("Route 53 hosted zone id or name (optional): ")).trim();

  const config: DomainConfig = {
    adminDomain: adminAnswer || undefined,
    apiDomain: apiAnswer || undefined,
    hostedZone: zoneAnswer || undefined,
  };
  validateDomains(config);

  if (options.persist) {
    updateConfig(options.repoRoot, {
      adminDomain: config.adminDomain,
      apiDomain: config.apiDomain,
      hostedZone: config.hostedZone,
    });
    options.log(`saved domain settings to ${CONFIG_FILE}`);
  }
  return config;
}

export interface ResolveAppPrefixOptions {
  repoRoot: string;
  prefix?: string;
  ask: Ask;
  log: Logger;
  persist: boolean;
}

export async function resolveAppPrefix(options: ResolveAppPrefixOptions): Promise<string> {
  const existing = loadConfig(options.repoRoot);

  if (options.prefix) {
    if (!isValidAppPrefix(options.prefix)) {
      throw new Error(
        `Invalid app prefix "${options.prefix}". Use lowercase letters, numbers, and hyphens.`,
      );
    }
    if (options.persist) {
      saveConfig(options.repoRoot, { ...existing, appPrefix: options.prefix });
    }
    return options.prefix;
  }

  if (existing?.appPrefix) {
    const reuse = await confirm(
      options.ask,
      `Reuse saved app prefix "${existing.appPrefix}"?`,
      true,
    );
    if (reuse) {
      return existing.appPrefix;
    }
  }

  const answer = (await options.ask("App prefix (lowercase letters, numbers, hyphens): ")).trim();
  if (!isValidAppPrefix(answer)) {
    throw new Error(`Invalid app prefix "${answer}". Use lowercase letters, numbers, and hyphens.`);
  }

  if (options.persist) {
    saveConfig(options.repoRoot, { ...existing, appPrefix: answer });
    options.log(`saved app prefix to ${CONFIG_FILE}`);
  }
  return answer;
}
