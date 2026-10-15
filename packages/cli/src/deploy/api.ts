import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  type DomainNameConfiguration,
} from "@aws-sdk/client-apigatewayv2";
import {
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import { build } from "esbuild";

import {
  addInvokePermission,
  deployFunction,
  ensureLambdaRole,
  putRolePolicy,
  updateFunctionEnvironment,
} from "../aws/lambda.ts";
import { apiNames } from "../aws/names.ts";
import { resolveHostedZoneId, upsertAliasRecords, type AliasTarget } from "../aws/route53.ts";
import { isAwsError, sleep } from "../util/aws.ts";
import { zipFile } from "../util/zip.ts";
import type { DeployContext } from "./context.ts";

async function bundleApi(repoRoot: string): Promise<Buffer> {
  const outfile = join(mkdtempSync(join(tmpdir(), "provisionless-api-")), "index.mjs");
  await build({
    entryPoints: [join(repoRoot, "packages", "api", "src", "lambda.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile,
    logLevel: "silent",
    alias: {
      "@provisionless/core": join(repoRoot, "packages", "core", "src", "index.ts"),
    },
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  return zipFile("index.mjs", new Uint8Array(readFileSync(outfile)));
}

async function findApiId(ctx: DeployContext): Promise<string | undefined> {
  const { api } = apiNames(ctx.appPrefix);
  const result = await ctx.clients.apiGateway.send(new GetApisCommand({}));
  return result.Items?.find((item) => item.Name === api)?.ApiId;
}

async function waitForDomainAvailable(
  ctx: DeployContext,
  domain: string,
): Promise<DomainNameConfiguration> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await ctx.clients.apiGateway.send(
      new GetDomainNameCommand({ DomainName: domain }),
    );
    const configuration = result.DomainNameConfigurations?.[0];
    if (configuration?.DomainNameStatus === "AVAILABLE") {
      if (!configuration.ApiGatewayDomainName) {
        throw new Error(`API Gateway custom domain ${domain} has no alias target`);
      }
      return configuration;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for API Gateway custom domain ${domain} to become available`);
}

async function configureApiDns(
  ctx: DeployContext,
  domain: string,
  target: AliasTarget,
): Promise<void> {
  if (ctx.hostedZone) {
    const hostedZoneId = await resolveHostedZoneId(ctx.clients.route53, ctx.hostedZone);
    ctx.log(`updating Route 53 alias record for ${domain}`);
    await upsertAliasRecords(ctx.clients.route53, hostedZoneId, [domain], target);
    return;
  }
  ctx.log(`add A/AAAA alias records in your DNS provider pointing ${domain} to ${target.dnsName}`);
}

export async function ensureApiDomain(
  ctx: DeployContext,
  apiId: string,
): Promise<string | undefined> {
  const domain = ctx.apiDomain;
  if (!domain) {
    return undefined;
  }

  if (ctx.dryRun) {
    ctx.log(`would create or update API Gateway custom domain ${domain}`);
    ctx.log(`would map API ${apiId} stage $default to ${domain}`);
    if (ctx.hostedZone) {
      ctx.log(`would upsert Route 53 alias records for ${domain}`);
    } else {
      ctx.log(
        `add A/AAAA alias records in your DNS provider pointing ${domain} to <custom-domain-target>`,
      );
    }
    return `https://${domain}`;
  }

  if (!ctx.apiCertificateArn || !ctx.apiCertificateIssued) {
    ctx.log(
      `api domain ${domain} not attached yet: the ACM certificate is still pending DNS validation; re-run deploy once it is issued`,
    );
    return undefined;
  }

  const listed = await ctx.clients.apiGateway.send(new GetDomainNamesCommand({}));
  const found = listed.Items?.find((item) => item.DomainName === domain);
  if (!found) {
    ctx.log(`creating API Gateway custom domain ${domain}`);
    await ctx.clients.apiGateway.send(
      new CreateDomainNameCommand({
        DomainName: domain,
        DomainNameConfigurations: [{ CertificateArn: ctx.apiCertificateArn }],
      }),
    );
  } else if (found.DomainNameConfigurations?.[0]?.CertificateArn !== ctx.apiCertificateArn) {
    ctx.log(`updating certificate on API Gateway custom domain ${domain}`);
    await ctx.clients.apiGateway.send(
      new UpdateDomainNameCommand({
        DomainName: domain,
        DomainNameConfigurations: [{ CertificateArn: ctx.apiCertificateArn }],
      }),
    );
  } else {
    ctx.log(`reusing API Gateway custom domain ${domain}`);
  }

  const configuration = await waitForDomainAvailable(ctx, domain);
  const target: AliasTarget = {
    dnsName: configuration.ApiGatewayDomainName ?? "",
    hostedZoneId: configuration.HostedZoneId ?? "",
  };

  const mappings = await ctx.clients.apiGateway.send(
    new GetApiMappingsCommand({ DomainName: domain }),
  );
  const mapped = mappings.Items?.some((item) => item.ApiId === apiId && item.Stage === "$default");
  if (!mapped) {
    ctx.log(`mapping API ${apiId} stage $default to ${domain}`);
    await ctx.clients.apiGateway.send(
      new CreateApiMappingCommand({ ApiId: apiId, DomainName: domain, Stage: "$default" }),
    );
  }

  await configureApiDns(ctx, domain, target);

  return `https://${domain}`;
}

export async function ensureHttpApi(ctx: DeployContext, functionArn: string): Promise<string> {
  const names = apiNames(ctx.appPrefix);
  let apiId = await findApiId(ctx);

  if (!apiId) {
    if (ctx.dryRun) {
      ctx.log(`would create API Gateway HTTP API ${names.api}`);
      const domainUrl = await ensureApiDomain(ctx, "<api-id>");
      return domainUrl ?? `https://<api-id>.execute-api.${ctx.region}.amazonaws.com`;
    }
    ctx.log(`creating API Gateway HTTP API ${names.api}`);
    const created = await ctx.clients.apiGateway.send(
      new CreateApiCommand({ Name: names.api, ProtocolType: "HTTP" }),
    );
    apiId = created.ApiId;
  }
  if (!apiId) {
    throw new Error("API Gateway did not return an API ID");
  }

  const integrations = await ctx.clients.apiGateway.send(
    new GetIntegrationsCommand({ ApiId: apiId }),
  );
  let integrationId = integrations.Items?.find(
    (integration) => integration.IntegrationUri === functionArn,
  )?.IntegrationId;

  if (!integrationId) {
    const created = await ctx.clients.apiGateway.send(
      new CreateIntegrationCommand({
        ApiId: apiId,
        IntegrationType: "AWS_PROXY",
        IntegrationUri: functionArn,
        PayloadFormatVersion: "2.0",
        TimeoutInMillis: 30000,
      }),
    );
    integrationId = created.IntegrationId;
  }
  if (!integrationId) {
    throw new Error("API Gateway did not return an integration ID");
  }

  const routes = await ctx.clients.apiGateway.send(new GetRoutesCommand({ ApiId: apiId }));
  if (!routes.Items?.some((route) => route.RouteKey === "$default")) {
    await ctx.clients.apiGateway.send(
      new CreateRouteCommand({
        ApiId: apiId,
        RouteKey: "$default",
        Target: `integrations/${integrationId}`,
      }),
    );
  }

  const stages = await ctx.clients.apiGateway.send(new GetStagesCommand({ ApiId: apiId }));
  if (!stages.Items?.some((stage) => stage.StageName === "$default")) {
    await ctx.clients.apiGateway.send(
      new CreateStageCommand({ ApiId: apiId, StageName: "$default", AutoDeploy: true }),
    );
  }

  await addInvokePermission(
    ctx,
    names.function,
    `apigateway-${apiId}`,
    "apigateway.amazonaws.com",
    `arn:aws:execute-api:${ctx.region}:${ctx.accountId}:${apiId}/*`,
  );

  const executeUrl = `https://${apiId}.execute-api.${ctx.region}.amazonaws.com`;
  const domainUrl = await ensureApiDomain(ctx, apiId);
  return domainUrl ?? executeUrl;
}

export async function ensureUsersTable(ctx: DeployContext): Promise<string> {
  const { usersTable } = apiNames(ctx.appPrefix);

  try {
    const existing = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: usersTable }),
    );
    if (existing.Table?.TableStatus === "ACTIVE") {
      return usersTable;
    }
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create DynamoDB table ${usersTable}`);
    return usersTable;
  }

  ctx.log(`creating DynamoDB table ${usersTable}`);
  await ctx.clients.dynamodb.send(
    new CreateTableCommand({
      TableName: usersTable,
      AttributeDefinitions: [
        { AttributeName: "username", AttributeType: "S" },
        { AttributeName: "id", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "username", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "id-index",
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: usersTable }),
    );
    if (result.Table?.TableStatus === "ACTIVE") {
      return usersTable;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for DynamoDB table ${usersTable}`);
}

export async function ensureResetTokensTable(ctx: DeployContext): Promise<string> {
  const { resetTokensTable } = apiNames(ctx.appPrefix);

  try {
    const existing = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: resetTokensTable }),
    );
    if (existing.Table?.TableStatus === "ACTIVE") {
      return resetTokensTable;
    }
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create DynamoDB table ${resetTokensTable}`);
    return resetTokensTable;
  }

  ctx.log(`creating DynamoDB table ${resetTokensTable}`);
  await ctx.clients.dynamodb.send(
    new CreateTableCommand({
      TableName: resetTokensTable,
      AttributeDefinitions: [{ AttributeName: "tokenHash", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "tokenHash", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await ctx.clients.dynamodb.send(
    new UpdateTimeToLiveCommand({
      TableName: resetTokensTable,
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    }),
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: resetTokensTable }),
    );
    if (result.Table?.TableStatus === "ACTIVE") {
      return resetTokensTable;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for DynamoDB table ${resetTokensTable}`);
}

export function apiEnv(ctx: DeployContext, jwtSecret: string): Record<string, string> {
  const names = apiNames(ctx.appPrefix);
  return {
    USERS_TABLE_NAME: names.usersTable,
    RESET_TOKENS_TABLE_NAME: names.resetTokensTable,
    MEDIA_BUCKET_NAME: ctx.mediaBucket,
    JWT_SECRET: jwtSecret,
  };
}

export async function configureApiAuth(
  ctx: DeployContext,
  jwtSecret: string,
  allowedOrigin: string,
): Promise<void> {
  if (ctx.dryRun) {
    ctx.log(`would allow API sign-in from ${allowedOrigin} (SameSite=None session cookies)`);
    return;
  }
  ctx.log(`allowing API sign-in from ${allowedOrigin}`);
  await updateFunctionEnvironment(ctx, apiNames(ctx.appPrefix).function, {
    ...apiEnv(ctx, jwtSecret),
    AUTH_ALLOW_ORIGINS: allowedOrigin,
    AUTH_COOKIE_SAMESITE: "None",
  });
}

export async function deployApi(ctx: DeployContext, jwtSecret: string): Promise<string> {
  const names = apiNames(ctx.appPrefix);
  ctx.log("bundling API Lambda");
  const zip = ctx.dryRun ? Buffer.alloc(0) : await bundleApi(ctx.repoRoot);
  const tableName = await ensureUsersTable(ctx);
  const resetTokensTable = await ensureResetTokensTable(ctx);
  const roleArn = await ensureLambdaRole(ctx, names.role);

  await putRolePolicy(ctx, names.role, `${ctx.appPrefix}-api`, [
    {
      Effect: "Allow",
      Action: [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
      ],
      Resource: [
        `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}`,
        `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}/index/*`,
        `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${resetTokensTable}`,
      ],
    },
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      Resource: `arn:aws:s3:::${ctx.mediaBucket}/*`,
    },
    {
      Effect: "Allow",
      Action: ["s3:ListBucket"],
      Resource: `arn:aws:s3:::${ctx.mediaBucket}`,
    },
  ]);

  const functionArn = await deployFunction(ctx, {
    name: names.function,
    roleArn,
    zip,
    handler: "index.handler",
    description: `Provisionless API (${ctx.appPrefix})`,
    timeout: 30,
    memorySize: 1024,
    env: {
      USERS_TABLE_NAME: tableName,
      RESET_TOKENS_TABLE_NAME: resetTokensTable,
      MEDIA_BUCKET_NAME: ctx.mediaBucket,
      JWT_SECRET: jwtSecret,
    },
  });
  const url = await ensureHttpApi(ctx, functionArn);
  ctx.log(`API deployed: ${url}`);
  return url;
}
