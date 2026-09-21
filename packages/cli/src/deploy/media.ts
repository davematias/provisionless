import { isValidBucketName, mediaBucketName } from "../aws/names.ts";
import { ensureBucket } from "../aws/s3.ts";
import { CONFIG_FILE, loadConfig, updateConfig } from "../config/config.ts";
import type { Logger } from "../util/log.ts";
import { confirm, type Ask } from "../util/prompt.ts";
import type { DeployContext } from "./context.ts";

export interface ResolveMediaBucketOptions {
  repoRoot: string;
  appPrefix: string;
  name?: string;
  ask: Ask;
  log: Logger;
  persist: boolean;
}

export async function resolveMediaBucket(options: ResolveMediaBucketOptions): Promise<string> {
  const existing = loadConfig(options.repoRoot);

  if (options.name) {
    const bucket = mediaBucketName(options.appPrefix, options.name);
    if (!isValidBucketName(bucket)) {
      throw new Error(`Invalid media bucket name "${bucket}".`);
    }
    if (options.persist) {
      updateConfig(options.repoRoot, { mediaBucket: bucket });
    }
    return bucket;
  }

  if (existing?.mediaBucket?.startsWith(`${options.appPrefix}-`)) {
    const reuse = await confirm(
      options.ask,
      `Reuse saved media bucket "${existing.mediaBucket}"?`,
      true,
    );
    if (reuse) {
      return existing.mediaBucket;
    }
  }

  const answer =
    (await options.ask("Media bucket name (the app prefix is prepended) [media]: ")).trim() ||
    "media";
  const bucket = mediaBucketName(options.appPrefix, answer);
  if (!isValidBucketName(bucket)) {
    throw new Error(`Invalid media bucket name "${bucket}".`);
  }

  if (options.persist) {
    updateConfig(options.repoRoot, { mediaBucket: bucket });
    options.log(`saved media bucket to ${CONFIG_FILE}`);
  }
  return bucket;
}

export async function deployMedia(ctx: DeployContext): Promise<void> {
  await ensureBucket(ctx, ctx.mediaBucket);
}
