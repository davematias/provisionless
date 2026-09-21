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
