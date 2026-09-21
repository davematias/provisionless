import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import type { DeployContext } from "./context.ts";
import { deployMedia, resolveMediaBucket } from "./media.ts";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "provisionless-media-"));
}

const noop = (): void => undefined;

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

function createContext(send: (command: unknown) => Promise<unknown>): DeployContext {
  return {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun: false,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: () => undefined,
    clients: { s3: { send } } as unknown as AwsClients,
  };
}

it("prefixes the bucket name with the app prefix", async () => {
  const repo = tempRepo();

  const bucket = await resolveMediaBucket({
    repoRoot: repo,
    appPrefix: "demo",
    name: "assets",
    ask: async () => "",
    log: noop,
    persist: true,
  });

  expect(bucket).toBe("demo-assets");
  expect(loadConfig(repo)?.mediaBucket).toBe("demo-assets");
});

it("does not double-prefix an already prefixed name", async () => {
  const bucket = await resolveMediaBucket({
    repoRoot: tempRepo(),
    appPrefix: "demo",
    name: "demo-assets",
    ask: async () => "",
    log: noop,
    persist: true,
  });

  expect(bucket).toBe("demo-assets");
});

it("prompts for a name and defaults to media", async () => {
  const bucket = await resolveMediaBucket({
    repoRoot: tempRepo(),
    appPrefix: "demo",
    ask: async () => "",
    log: noop,
    persist: true,
  });

  expect(bucket).toBe("demo-media");
});

it("reuses the saved bucket when confirmed", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", mediaBucket: "demo-media" });

  const bucket = await resolveMediaBucket({
    repoRoot: repo,
    appPrefix: "demo",
    ask: async () => "y",
    log: noop,
    persist: true,
  });

  expect(bucket).toBe("demo-media");
});

it("creates the bucket when it does not exist", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (commandName(command) === "HeadBucketCommand") {
      const error = new Error("missing");
      error.name = "NotFound";
      throw error;
    }
    return {};
  });

  await deployMedia(ctx);

  expect(commands.map(commandName)).toContain("CreateBucketCommand");
});

it("reuses an existing bucket (idempotent)", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  });

  await deployMedia(ctx);

  expect(commands.map(commandName)).toContain("HeadBucketCommand");
  expect(commands.map(commandName)).not.toContain("CreateBucketCommand");
});
