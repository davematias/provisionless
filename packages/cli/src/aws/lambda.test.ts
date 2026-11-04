import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  GetRoleCommand,
  TagRoleCommand,
} from "@aws-sdk/client-iam";
import {
  CreateFunctionCommand,
  GetFunctionCommand,
  TagResourceCommand as LambdaTagResourceCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { expect, it } from "vitest";

import type { AwsClients } from "./clients.ts";
import { deployFunction, ensureLambdaRole } from "./lambda.ts";
import { deploymentTagList, deploymentTags } from "./tags.ts";
import type { DeployContext } from "../deploy/context.ts";

function createContext(
  iamSend: (command: unknown) => Promise<unknown>,
  lambdaSend: (command: unknown) => Promise<unknown>,
): DeployContext {
  return {
    region: "eu-west-1",
    accountId: "111122223333",
    dryRun: false,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: () => undefined,
    clients: {
      iam: { send: iamSend },
      lambda: { send: lambdaSend },
    } as unknown as AwsClients,
  };
}

function missing(name: string): never {
  const error = new Error(name);
  error.name = name;
  throw error;
}

it("creates a role with the deployment tags", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(
    async (command) => {
      commands.push(command);
      if (command instanceof GetRoleCommand) {
        return missing("NoSuchEntityException");
      }
      return { Role: { Arn: "arn:aws:iam::111122223333:role/demo-api" } };
    },
    async () => ({}),
  );

  const arn = await ensureLambdaRole(ctx, "demo-api");

  expect(arn).toBe("arn:aws:iam::111122223333:role/demo-api");
  const create = commands.find((command) => command instanceof CreateRoleCommand) as
    | CreateRoleCommand
    | undefined;
  expect(create?.input.Tags).toEqual(deploymentTagList("demo"));
  expect(commands.some((command) => command instanceof AttachRolePolicyCommand)).toBe(true);
});

it("tags an existing role", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(
    async (command) => {
      commands.push(command);
      return { Role: { Arn: "arn:aws:iam::111122223333:role/demo-api" } };
    },
    async () => ({}),
  );

  await ensureLambdaRole(ctx, "demo-api");

  expect(commands.some((command) => command instanceof CreateRoleCommand)).toBe(false);
  const tag = commands.find((command) => command instanceof TagRoleCommand) as
    | TagRoleCommand
    | undefined;
  expect(tag?.input).toEqual({
    RoleName: "demo-api",
    Tags: deploymentTagList("demo"),
  });
});

it("creates a Lambda with the deployment tags", async () => {
  const commands: unknown[] = [];
  const active = { Configuration: { State: "Active", LastUpdateStatus: "Successful" } };
  let calls = 0;
  const ctx = createContext(
    async () => ({}),
    async (command) => {
      commands.push(command);
      if (command instanceof GetFunctionCommand) {
        calls += 1;
        return calls === 1 ? missing("ResourceNotFoundException") : active;
      }
      return {};
    },
  );

  await deployFunction(ctx, {
    name: "demo-api",
    roleArn: "arn:aws:iam::111122223333:role/demo-api",
    zip: Buffer.from("zip"),
    handler: "index.handler",
    description: "demo",
  });

  const create = commands.find((command) => command instanceof CreateFunctionCommand) as
    | CreateFunctionCommand
    | undefined;
  expect(create?.input.Tags).toEqual(deploymentTags("demo"));
  expect(commands.some((command) => command instanceof LambdaTagResourceCommand)).toBe(false);
});

it("tags an existing Lambda after updating it", async () => {
  const commands: unknown[] = [];
  const active = { Configuration: { State: "Active", LastUpdateStatus: "Successful" } };
  const ctx = createContext(
    async () => ({}),
    async (command) => {
      commands.push(command);
      if (command instanceof GetFunctionCommand) {
        return active;
      }
      return {};
    },
  );

  await deployFunction(ctx, {
    name: "demo-api",
    roleArn: "arn:aws:iam::111122223333:role/demo-api",
    zip: Buffer.from("zip"),
    handler: "index.handler",
    description: "demo",
  });

  expect(commands.some((command) => command instanceof UpdateFunctionConfigurationCommand)).toBe(
    true,
  );
  expect(commands.some((command) => command instanceof UpdateFunctionCodeCommand)).toBe(true);
  const tag = commands.find((command) => command instanceof LambdaTagResourceCommand) as
    | LambdaTagResourceCommand
    | undefined;
  expect(tag?.input).toEqual({
    Resource: "arn:aws:lambda:eu-west-1:111122223333:function:demo-api",
    Tags: deploymentTags("demo"),
  });
});
