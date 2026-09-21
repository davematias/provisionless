import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import type { DeployContext } from "./context.ts";
import { teardown } from "./undeploy.ts";

function createContext(send: (command: unknown) => Promise<unknown>): DeployContext {
  const clients = {
    cloudfront: {
      send: async () => ({
        DistributionList: { Items: [] },
        OriginAccessControlList: { Items: [] },
      }),
    },
    lambda: { send },
    apiGateway: { send: async () => ({ Items: [] }) },
    sqs: {
      send: async () => {
        const error = new Error("missing");
        error.name = "QueueDoesNotExist";
        throw error;
      },
    },
    dynamodb: {
      send: async () => {
        const error = new Error("missing");
        error.name = "ResourceNotFoundException";
        throw error;
      },
    },
    s3: {
      send: async () => {
        const error = new Error("missing");
        error.name = "NotFound";
        throw error;
      },
    },
    iam: {
      send: async () => {
        const error = new Error("missing");
        error.name = "NoSuchEntityException";
        throw error;
      },
    },
  } as unknown as AwsClients;

  return {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun: true,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: () => undefined,
    clients,
  };
}

it("reports that existing Lambdas would be deleted in a dry run", async () => {
  const messages: string[] = [];
  const ctx = createContext(async () => ({}));
  ctx.log = (message: string) => messages.push(message);

  await teardown(ctx, true);

  expect(messages).toContain("would delete Lambda demo-admin-revalidation");
  expect(messages).toContain("would delete Lambda demo-api");
});

it("keeps data when asked", async () => {
  const messages: string[] = [];
  const ctx = createContext(async () => ({}));
  ctx.log = (message: string) => messages.push(message);

  await teardown(ctx, true);

  expect(
    messages.some(
      (message) => message.startsWith("keeping data:") && message.includes("demo-users"),
    ),
  ).toBe(true);
  expect(messages.some((message) => message.includes("would delete DynamoDB table"))).toBe(false);
  expect(messages.some((message) => message.includes("would empty and delete S3 bucket"))).toBe(
    false,
  );
});
