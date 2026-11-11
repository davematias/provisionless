import {
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  DescribeResourcePoliciesCommand,
  PutResourcePolicyCommand,
  PutRetentionPolicyCommand,
  TagResourceCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { expect, it } from "vitest";

import type { AwsClients } from "./clients.ts";
import {
  API_GATEWAY_ACCESS_LOG_FORMAT,
  DEFAULT_ACCESS_LOG_RETENTION,
  deleteLogGroup,
  deleteLogGroupNamed,
  ensureApiGatewayAccessLogs,
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

it("creates the API access log group and resource policy", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof DescribeResourcePoliciesCommand) {
      return { resourcePolicies: [] };
    }
    return {};
  });

  const result = await ensureApiGatewayAccessLogs(ctx, "/aws/apigateway/demo-api/access", "api123");

  expect(result).toEqual({
    destinationArn: "arn:aws:logs:eu-west-1:111122223333:log-group:/aws/apigateway/demo-api/access",
    format: API_GATEWAY_ACCESS_LOG_FORMAT,
  });
  const create = commands.find(
    (command): command is CreateLogGroupCommand => command instanceof CreateLogGroupCommand,
  );
  expect(create?.input.logGroupName).toBe("/aws/apigateway/demo-api/access");
  const retention = commands.find(
    (command): command is PutRetentionPolicyCommand => command instanceof PutRetentionPolicyCommand,
  );
  expect(retention?.input.retentionInDays).toBe(DEFAULT_ACCESS_LOG_RETENTION);
  expect(DEFAULT_ACCESS_LOG_RETENTION).toBe(14);

  const put = commands.find(
    (command): command is PutResourcePolicyCommand => command instanceof PutResourcePolicyCommand,
  );
  expect(put?.input.policyName).toBe("demo-api-access");
  expect(put?.input.resourceArn).toBe(
    "arn:aws:logs:eu-west-1:111122223333:log-group:/aws/apigateway/demo-api/access",
  );
  expect(put?.input.expectedRevisionId).toBeNull();
  const policy = JSON.parse(put?.input.policyDocument ?? "{}") as {
    Statement?: Array<Record<string, unknown>>;
  };
  expect(policy.Statement?.[0]).toMatchObject({
    Effect: "Allow",
    Principal: { Service: "apigateway.amazonaws.com" },
    Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
    Resource: "arn:aws:logs:eu-west-1:111122223333:log-group:/aws/apigateway/demo-api/access:*",
    Condition: {
      ArnLike: {
        "aws:SourceArn": "arn:aws:execute-api:eu-west-1:111122223333:api123/*",
      },
      StringEquals: { "aws:SourceAccount": "111122223333" },
    },
  });
});

it("reuses a matching access log resource policy on redeploy", async () => {
  const commands: unknown[] = [];
  let policyDocument = "";
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof DescribeResourcePoliciesCommand) {
      return policyDocument
        ? {
            resourcePolicies: [
              { policyName: "demo-api-access", policyDocument, revisionId: "rev1" },
            ],
          }
        : { resourcePolicies: [] };
    }
    if (command instanceof PutResourcePolicyCommand) {
      policyDocument = command.input.policyDocument ?? "";
    }
    return {};
  });

  await ensureApiGatewayAccessLogs(ctx, "/aws/apigateway/demo-api/access", "api123");
  await ensureApiGatewayAccessLogs(ctx, "/aws/apigateway/demo-api/access", "api123");

  const puts = commands.filter(
    (command): command is PutResourcePolicyCommand => command instanceof PutResourcePolicyCommand,
  );
  expect(puts).toHaveLength(1);
});

it("updates a changed access log resource policy with its revision", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof DescribeResourcePoliciesCommand) {
      return {
        resourcePolicies: [
          { policyName: "demo-api-access", policyDocument: "old", revisionId: "rev1" },
        ],
      };
    }
    return {};
  });

  await ensureApiGatewayAccessLogs(ctx, "/aws/apigateway/demo-api/access", "api123");

  const put = commands.find(
    (command): command is PutResourcePolicyCommand => command instanceof PutResourcePolicyCommand,
  );
  expect(put?.input.expectedRevisionId).toBe("rev1");
});

it("does not touch CloudWatch for access logs during a dry run", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  }, true);
  ctx.log = (message: string) => logs.push(message);

  const result = await ensureApiGatewayAccessLogs(ctx, "/aws/apigateway/demo-api/access", "api123");

  expect(commands).toEqual([]);
  expect(result.format).toBe(API_GATEWAY_ACCESS_LOG_FORMAT);
  expect(logs).toContain(
    "would create log group /aws/apigateway/demo-api/access with 14-day retention and enable API Gateway access logs",
  );
});

it("deletes a named access log group", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  });

  await deleteLogGroupNamed(ctx, "/aws/apigateway/demo-api/access");

  expect(commands[0]).toBeInstanceOf(DeleteLogGroupCommand);
  expect((commands[0] as DeleteLogGroupCommand).input.logGroupName).toBe(
    "/aws/apigateway/demo-api/access",
  );
});
