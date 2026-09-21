import {
  CreateApiCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  GetApisCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
} from "@aws-sdk/client-apigatewayv2";
import { CreateTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import { ensureHttpApi, ensureUsersTable } from "./api.ts";
import type { DeployContext } from "./context.ts";

const FUNCTION_ARN = "arn:aws:lambda:us-east-1:111122223333:function:provisionless-api";

function createContext(apiGatewaySend: (command: unknown) => Promise<unknown>): DeployContext {
  const clients = {
    apiGateway: { send: apiGatewaySend },
    lambda: { send: async () => ({}) },
  } as unknown as AwsClients;

  return {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun: false,
    repoRoot: ".",
    appPrefix: "provisionless",
    log: () => undefined,
    clients,
  };
}

it("creates an HTTP API, integration, default route, and stage", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof GetApisCommand) return { Items: [] };
    if (command instanceof CreateApiCommand) return { ApiId: "api123" };
    if (command instanceof GetIntegrationsCommand) return { Items: [] };
    if (command instanceof CreateIntegrationCommand) return { IntegrationId: "int1" };
    if (command instanceof GetRoutesCommand) return { Items: [] };
    if (command instanceof GetStagesCommand) return { Items: [] };
    return {};
  });

  const url = await ensureHttpApi(ctx, FUNCTION_ARN);

  expect(url).toBe("https://api123.execute-api.us-east-1.amazonaws.com");
  expect(commands.some((command) => command instanceof CreateIntegrationCommand)).toBe(true);
  expect(commands.some((command) => command instanceof CreateRouteCommand)).toBe(true);
  expect(commands.some((command) => command instanceof CreateStageCommand)).toBe(true);
});

it("reuses an existing HTTP API instead of creating another", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof GetApisCommand)
      return { Items: [{ ApiId: "existing", Name: "provisionless-api" }] };
    if (command instanceof GetIntegrationsCommand)
      return { Items: [{ IntegrationId: "int1", IntegrationUri: FUNCTION_ARN }] };
    if (command instanceof GetRoutesCommand) return { Items: [{ RouteKey: "$default" }] };
    if (command instanceof GetStagesCommand) return { Items: [{ StageName: "$default" }] };
    return {};
  });

  const url = await ensureHttpApi(ctx, FUNCTION_ARN);

  expect(url).toBe("https://existing.execute-api.us-east-1.amazonaws.com");
  expect(commands.some((command) => command instanceof CreateApiCommand)).toBe(false);
  expect(commands.some((command) => command instanceof CreateIntegrationCommand)).toBe(false);
  expect(commands.some((command) => command instanceof CreateRouteCommand)).toBe(false);
  expect(commands.some((command) => command instanceof CreateStageCommand)).toBe(false);
});

interface TableInput {
  KeySchema?: { AttributeName?: string; KeyType?: string }[];
  GlobalSecondaryIndexes?: { IndexName?: string }[];
}

function createDynamoContext(send: (command: unknown) => Promise<unknown>): DeployContext {
  return {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun: false,
    repoRoot: ".",
    appPrefix: "provisionless",
    log: () => undefined,
    clients: { dynamodb: { send } } as unknown as AwsClients,
  };
}

it("creates the users table with the username key and id index", async () => {
  const commands: unknown[] = [];
  let describeCalls = 0;
  const ctx = createDynamoContext(async (command) => {
    commands.push(command);
    if (command instanceof DescribeTableCommand) {
      describeCalls += 1;
      if (describeCalls === 1) {
        const error = new Error("missing");
        error.name = "ResourceNotFoundException";
        throw error;
      }
      return { Table: { TableStatus: "ACTIVE" } };
    }
    return {};
  });

  const tableName = await ensureUsersTable(ctx);

  expect(tableName).toBe("provisionless-users");
  const create = commands.find((command) => command instanceof CreateTableCommand) as
    | { input: TableInput }
    | undefined;
  expect(create?.input.KeySchema).toEqual([{ AttributeName: "username", KeyType: "HASH" }]);
  expect(create?.input.GlobalSecondaryIndexes?.[0]?.IndexName).toBe("id-index");
});

it("reuses an existing users table", async () => {
  let created = false;
  const ctx = createDynamoContext(async (command) => {
    if (command instanceof CreateTableCommand) {
      created = true;
    }
    return { Table: { TableStatus: "ACTIVE" } };
  });

  const tableName = await ensureUsersTable(ctx);

  expect(tableName).toBe("provisionless-users");
  expect(created).toBe(false);
});
