import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketTaggingCommand,
} from "@aws-sdk/client-s3";
import { expect, it } from "vitest";

import type { AwsClients } from "./clients.ts";
import { ensureBucket } from "./s3.ts";
import { deploymentTagList } from "./tags.ts";
import type { DeployContext } from "../deploy/context.ts";

function createContext(
  send: (command: unknown) => Promise<unknown>,
  dryRun = false,
): DeployContext {
  return {
    region: "eu-west-1",
    accountId: "111122223333",
    dryRun,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: () => undefined,
    clients: { s3: { send } } as unknown as AwsClients,
  };
}

function missingBucket(): never {
  const error = new Error("missing");
  error.name = "NotFound";
  throw error;
}

it("tags a bucket it creates", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof HeadBucketCommand) {
      return missingBucket();
    }
    return {};
  });

  await ensureBucket(ctx, "demo-media");

  expect(commands.some((command) => command instanceof CreateBucketCommand)).toBe(true);
  const tagging = commands.find(
    (command) => command instanceof PutBucketTaggingCommand,
  ) as PutBucketTaggingCommand;
  expect(tagging.input).toEqual({
    Bucket: "demo-media",
    Tagging: { TagSet: deploymentTagList("demo") },
  });
});

it("tags a bucket it adopts", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  });

  await ensureBucket(ctx, "demo-media");

  expect(commands.some((command) => command instanceof CreateBucketCommand)).toBe(false);
  const tagging = commands.find(
    (command) => command instanceof PutBucketTaggingCommand,
  ) as PutBucketTaggingCommand;
  expect(tagging.input.Tagging).toEqual({ TagSet: deploymentTagList("demo") });
});

it("does not tag during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    throw missingBucket();
  }, true);

  await ensureBucket(ctx, "demo-media");

  expect(commands.some((command) => command instanceof PutBucketTaggingCommand)).toBe(false);
});
