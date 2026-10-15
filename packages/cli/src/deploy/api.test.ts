import {
  CreateApiCommand,
  CreateApiMappingCommand,
  CreateDomainNameCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  GetApiMappingsCommand,
  GetApisCommand,
  GetDomainNameCommand,
  GetDomainNamesCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
  UpdateDomainNameCommand,
} from "@aws-sdk/client-apigatewayv2";
import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
} from "@aws-sdk/client-route-53";
import { GetFunctionCommand, UpdateFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import {
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import {
  configureApiAuth,
  ensureApiDomain,
  ensureHttpApi,
  ensureResetTokensTable,
  ensureUsersTable,
} from "./api.ts";
import type { DeployContext } from "./context.ts";

const FUNCTION_ARN = "arn:aws:lambda:us-east-1:111122223333:function:provisionless-api";

function createContext(apiGatewaySend: (command: unknown) => Promise<unknown>): DeployContext {
  const clients = {
    apiGateway: { send: apiGatewaySend },
    lambda: { send: apiGatewaySend },
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

it("creates the reset tokens table with a tokenHash key and expiry TTL", async () => {
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

  const tableName = await ensureResetTokensTable(ctx);

  expect(tableName).toBe("provisionless-reset-tokens");
  const create = commands.find((command) => command instanceof CreateTableCommand) as
    | { input: TableInput }
    | undefined;
  expect(create?.input.KeySchema).toEqual([{ AttributeName: "tokenHash", KeyType: "HASH" }]);
  const ttl = commands.find((command) => command instanceof UpdateTimeToLiveCommand) as
    | {
        input: {
          TimeToLiveSpecification?: { AttributeName?: string; Enabled?: boolean };
        };
      }
    | undefined;
  expect(ttl?.input.TimeToLiveSpecification).toEqual({
    AttributeName: "expiresAt",
    Enabled: true,
  });
});

it("reuses an existing reset tokens table", async () => {
  let created = false;
  const ctx = createDynamoContext(async (command) => {
    if (command instanceof CreateTableCommand) {
      created = true;
    }
    return { Table: { TableStatus: "ACTIVE" } };
  });

  const tableName = await ensureResetTokensTable(ctx);

  expect(tableName).toBe("provisionless-reset-tokens");
  expect(created).toBe(false);
});

const CERT_ARN = "arn:aws:acm:us-east-1:111122223333:certificate/api";

interface DomainOptions {
  apiDomain?: string;
  apiCertificateArn?: string;
  apiCertificateIssued?: boolean;
  hostedZone?: string;
  dryRun?: boolean;
}

function createDomainContext(
  commands: unknown[],
  respond: (command: unknown) => unknown,
  options: DomainOptions,
  logs?: string[],
): DeployContext {
  const send = async (command: unknown) => {
    commands.push(command);
    return respond(command);
  };
  return {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun: options.dryRun ?? false,
    repoRoot: ".",
    appPrefix: "provisionless",
    apiDomain: options.apiDomain,
    apiCertificateArn: options.apiCertificateArn,
    apiCertificateIssued: options.apiCertificateIssued,
    hostedZone: options.hostedZone,
    log: (message: string) => logs?.push(message),
    clients: {
      apiGateway: { send },
      route53: { send },
    } as unknown as AwsClients,
  };
}

const AVAILABLE = {
  ApiGatewayDomainName: "abc123.apigateway.us-east-1.amazonaws.com",
  HostedZoneId: "Z35PDXIG0G6M0K",
  DomainNameStatus: "AVAILABLE" as const,
  CertificateArn: CERT_ARN,
};

function availableDomain() {
  return (command: unknown): unknown => {
    if (command instanceof GetDomainNamesCommand) return { Items: [] };
    if (command instanceof GetDomainNameCommand) {
      return { DomainNameConfigurations: [AVAILABLE] };
    }
    if (command instanceof GetApiMappingsCommand) return { Items: [] };
    return {};
  };
}

it("creates a regional custom domain, maps the default stage, and returns the custom URL", async () => {
  const commands: unknown[] = [];
  const ctx = createDomainContext(commands, availableDomain(), {
    apiDomain: "api.example.com",
    apiCertificateArn: CERT_ARN,
    apiCertificateIssued: true,
  });

  const url = await ensureApiDomain(ctx, "api123");

  expect(url).toBe("https://api.example.com");
  const create = commands.find((command) => command instanceof CreateDomainNameCommand) as
    | { input: { DomainName?: string; DomainNameConfigurations?: { CertificateArn?: string }[] } }
    | undefined;
  expect(create?.input.DomainName).toBe("api.example.com");
  expect(create?.input.DomainNameConfigurations?.[0]?.CertificateArn).toBe(CERT_ARN);
  const mapping = commands.find((command) => command instanceof CreateApiMappingCommand) as
    | { input: { ApiId?: string; Stage?: string } }
    | undefined;
  expect(mapping?.input.ApiId).toBe("api123");
  expect(mapping?.input.Stage).toBe("$default");
});

it("prints the DNS target and does not touch Route 53 without a hosted zone", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const ctx = createDomainContext(
    commands,
    availableDomain(),
    { apiDomain: "api.example.com", apiCertificateArn: CERT_ARN, apiCertificateIssued: true },
    logs,
  );

  await ensureApiDomain(ctx, "api123");

  expect(
    logs.some(
      (message) =>
        message.includes("api.example.com") &&
        message.includes("abc123.apigateway.us-east-1.amazonaws.com"),
    ),
  ).toBe(true);
  expect(commands.some((command) => command instanceof ChangeResourceRecordSetsCommand)).toBe(
    false,
  );
});

it("upserts a Route 53 alias record pointing at the regional domain target", async () => {
  const commands: unknown[] = [];
  const ctx = createDomainContext(
    commands,
    (command) => {
      if (command instanceof ListHostedZonesByNameCommand) {
        return { HostedZones: [{ Id: "/hostedzone/Z9", Name: "example.com." }] };
      }
      return availableDomain()(command);
    },
    {
      apiDomain: "api.example.com",
      apiCertificateArn: CERT_ARN,
      apiCertificateIssued: true,
      hostedZone: "example.com",
    },
  );

  await ensureApiDomain(ctx, "api123");

  const change = commands.find((command) => command instanceof ChangeResourceRecordSetsCommand) as
    | {
        input: {
          HostedZoneId?: string;
          ChangeBatch?: {
            Changes?: {
              ResourceRecordSet?: {
                Name?: string;
                AliasTarget?: { DNSName?: string; HostedZoneId?: string };
              };
            }[];
          };
        };
      }
    | undefined;
  expect(change?.input.HostedZoneId).toBe("Z9");
  const changes = change?.input.ChangeBatch?.Changes ?? [];
  expect(changes).toHaveLength(2);
  expect(
    changes.every(
      (item) =>
        item.ResourceRecordSet?.AliasTarget?.DNSName ===
          "abc123.apigateway.us-east-1.amazonaws.com" &&
        item.ResourceRecordSet?.AliasTarget?.HostedZoneId === "Z35PDXIG0G6M0K",
    ),
  ).toBe(true);
});

it("reuses an existing custom domain and mapping on re-deploy", async () => {
  const commands: unknown[] = [];
  const ctx = createDomainContext(
    commands,
    (command) => {
      if (command instanceof GetDomainNamesCommand) {
        return {
          Items: [{ DomainName: "api.example.com", DomainNameConfigurations: [AVAILABLE] }],
        };
      }
      if (command instanceof GetDomainNameCommand) {
        return { DomainNameConfigurations: [AVAILABLE] };
      }
      if (command instanceof GetApiMappingsCommand) {
        return { Items: [{ ApiId: "api123", Stage: "$default" }] };
      }
      return {};
    },
    { apiDomain: "api.example.com", apiCertificateArn: CERT_ARN, apiCertificateIssued: true },
  );

  const url = await ensureApiDomain(ctx, "api123");

  expect(url).toBe("https://api.example.com");
  expect(commands.some((command) => command instanceof CreateDomainNameCommand)).toBe(false);
  expect(commands.some((command) => command instanceof UpdateDomainNameCommand)).toBe(false);
  expect(commands.some((command) => command instanceof CreateApiMappingCommand)).toBe(false);
});

it("updates the certificate when the existing custom domain uses a different ARN", async () => {
  const commands: unknown[] = [];
  const ctx = createDomainContext(
    commands,
    (command) => {
      if (command instanceof GetDomainNamesCommand) {
        return {
          Items: [
            {
              DomainName: "api.example.com",
              DomainNameConfigurations: [{ ...AVAILABLE, CertificateArn: "arn:old" }],
            },
          ],
        };
      }
      if (command instanceof GetDomainNameCommand) {
        return { DomainNameConfigurations: [AVAILABLE] };
      }
      if (command instanceof GetApiMappingsCommand) {
        return { Items: [{ ApiId: "api123", Stage: "$default" }] };
      }
      return {};
    },
    { apiDomain: "api.example.com", apiCertificateArn: CERT_ARN, apiCertificateIssued: true },
  );

  const url = await ensureApiDomain(ctx, "api123");

  expect(url).toBe("https://api.example.com");
  expect(commands.some((command) => command instanceof UpdateDomainNameCommand)).toBe(true);
  expect(commands.some((command) => command instanceof CreateDomainNameCommand)).toBe(false);
});

it("returns the execute-api URL (undefined domain) when the certificate is pending", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const ctx = createDomainContext(
    commands,
    availableDomain(),
    { apiDomain: "api.example.com", apiCertificateArn: CERT_ARN, apiCertificateIssued: false },
    logs,
  );

  const url = await ensureApiDomain(ctx, "api123");

  expect(url).toBeUndefined();
  expect(logs.some((message) => message.includes("not attached yet"))).toBe(true);
  expect(commands.some((command) => command instanceof CreateDomainNameCommand)).toBe(false);
});

it("logs intended actions and returns the custom URL during a dry run", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const ctx = createDomainContext(
    commands,
    availableDomain(),
    { apiDomain: "api.example.com", apiCertificateArn: CERT_ARN, dryRun: true },
    logs,
  );

  const url = await ensureApiDomain(ctx, "api123");

  expect(url).toBe("https://api.example.com");
  expect(
    logs.some((message) => message.includes("would create or update API Gateway custom domain")),
  ).toBe(true);
  expect(
    commands.some(
      (command) =>
        command instanceof CreateDomainNameCommand ||
        command instanceof CreateApiMappingCommand ||
        command instanceof ChangeResourceRecordSetsCommand,
    ),
  ).toBe(false);
});

it("reports the custom domain URL through ensureHttpApi when the domain is attached", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const send = async (command: unknown) => {
    commands.push(command);
    if (command instanceof GetApisCommand)
      return { Items: [{ ApiId: "api123", Name: "provisionless-api" }] };
    if (command instanceof GetIntegrationsCommand)
      return { Items: [{ IntegrationId: "int1", IntegrationUri: FUNCTION_ARN }] };
    if (command instanceof GetRoutesCommand) return { Items: [{ RouteKey: "$default" }] };
    if (command instanceof GetStagesCommand) return { Items: [{ StageName: "$default" }] };
    return availableDomain()(command);
  };
  const ctx: DeployContext = {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun: false,
    repoRoot: ".",
    appPrefix: "provisionless",
    mediaBucket: "demo-media",
    apiDomain: "api.example.com",
    apiCertificateArn: CERT_ARN,
    apiCertificateIssued: true,
    log: (message: string) => logs.push(message),
    clients: {
      apiGateway: { send },
      route53: { send },
      lambda: { send },
    } as unknown as AwsClients,
  };

  const url = await ensureHttpApi(ctx, FUNCTION_ARN);

  expect(url).toBe("https://api.example.com");
});

it("configures the API function env for cross-site sign-in", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    if (command instanceof GetFunctionCommand) {
      return { Configuration: { State: "Active", LastUpdateStatus: "Successful" } };
    }
    return {};
  });

  await configureApiAuth(ctx, "secret", "https://admin.example.com");

  const update = commands.find(
    (command) => command instanceof UpdateFunctionConfigurationCommand,
  ) as
    | { input: { FunctionName?: string; Environment?: { Variables?: Record<string, string> } } }
    | undefined;
  expect(update?.input.FunctionName).toBe("provisionless-api");
  expect(update?.input.Environment?.Variables?.AUTH_ALLOW_ORIGINS).toBe(
    "https://admin.example.com",
  );
  expect(update?.input.Environment?.Variables?.AUTH_COOKIE_SAMESITE).toBe("None");
  expect(update?.input.Environment?.Variables?.JWT_SECRET).toBe("secret");
  expect(update?.input.Environment?.Variables?.USERS_TABLE_NAME).toBe("provisionless-users");
  expect(update?.input.Environment?.Variables?.RESET_TOKENS_TABLE_NAME).toBe(
    "provisionless-reset-tokens",
  );
});

it("only reports the cross-site configuration during a dry run", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  });
  ctx.dryRun = true;
  ctx.log = (message: string) => logs.push(message);

  await configureApiAuth(ctx, "secret", "https://admin.example.com");

  expect(commands).toEqual([]);
  expect(
    logs.some((message) =>
      message.includes("would allow API sign-in from https://admin.example.com"),
    ),
  ).toBe(true);
});
