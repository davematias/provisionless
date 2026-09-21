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
import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import { ensureHttpApi } from "./api.ts";
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
