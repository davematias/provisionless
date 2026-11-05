import {
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  PutRetentionPolicyCommand,
  TagResourceCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { expect, it } from "vitest";

import type { AwsClients } from "./clients.ts";
import {
  deleteLogGroup,
  ensureLogGroup,
  lambdaLogGroupName,
  validateLogRetention,
} from "./logs.ts";
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
    clients: { logs: { send } } as unknown as AwsClients,
  };
}

it("names Lambda log groups", () => {
  expect(lambdaLogGroupName("demo-api")).toBe("/aws/lambda/demo-api");
});

it("validates retention values", () => {
  expect(validateLogRetention(30)).toBe(30);
  expect(validateLogRetention(14)).toBe(14);
  expect(() => validateLogRetention(0)).toThrow(/at least 1/);
  expect(() => validateLogRetention(-5)).toThrow(/at least 1/);
  expect(() => validateLogRetention(2.5)).toThrow(/whole number/);
  expect(() => validateLogRetention(2)).toThrow(/must be one of/);
});

it("creates a log group and applies retention", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  });

  await ensureLogGroup(ctx, "demo-api", 30);

  expect(commands[0]).toBeInstanceOf(CreateLogGroupCommand);
  const retention = commands.find(
    (command) => command instanceof PutRetentionPolicyCommand,
  ) as PutRetentionPolicyCommand;
  expect(retention.input).toEqual({
    logGroupName: "/aws/lambda/demo-api",
    retentionInDays: 30,
  });
  const tag = commands.find(
    (command) => command instanceof TagResourceCommand,
  ) as TagResourceCommand;
  expect(tag.input).toEqual({
    resourceArn: "arn:aws:logs:eu-west-1:111122223333:log-group:/aws/lambda/demo-api",
    tags: { "provisionless:managed": "true", "provisionless:app": "demo" },
  });
});

it("updates retention when the log group already exists", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof CreateLogGroupCommand) {
      const error = new Error("exists");
      error.name = "ResourceAlreadyExistsException";
      throw error;
    }
    return {};
  });

  await ensureLogGroup(ctx, "demo-api", 14);

  expect(commands.some((command) => command instanceof CreateLogGroupCommand)).toBe(true);
  const retention = commands.find(
    (command) => command instanceof PutRetentionPolicyCommand,
  ) as PutRetentionPolicyCommand;
  expect(retention.input.retentionInDays).toBe(14);
  expect(commands.some((command) => command instanceof TagResourceCommand)).toBe(true);
});

it("deletes a log group and ignores a missing one", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof DeleteLogGroupCommand) {
      const error = new Error("missing");
      error.name = "ResourceNotFoundException";
      throw error;
    }
    return {};
  });

  await deleteLogGroup(ctx, "demo-api");

  expect(commands[0]).toBeInstanceOf(DeleteLogGroupCommand);
  expect((commands[0] as DeleteLogGroupCommand).input.logGroupName).toBe("/aws/lambda/demo-api");
});

it("does not touch CloudWatch during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  }, true);

  await ensureLogGroup(ctx, "demo-api", 30);
  await deleteLogGroup(ctx, "demo-api");

  expect(commands).toEqual([]);
});
